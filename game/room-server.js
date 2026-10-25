import { DurableObject } from "cloudflare:workers";
import { member, publicRoom } from "./rooms.js";
import { RoomSimulation } from "./room-simulation.js";
import { compactGame } from "./room-snapshot.js";
import {
  NET,
  protocol,
  readBody,
  TokenBucket,
  integer,
  clone,
} from "./net-protocol.js";
export class RoomRealtime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.sim = null;
    this.code = "";
    this.loaded = null;
    this.timer = null;
    this.lastBroadcast = 0;
    this.lastSave = 0;
    this.lastMetadata = 0;
    this.sequence = 0;
    this.rates = new Map();
    this.receipts = new Map();
    this.controllers = new Map();
    this.savePending = null;
    this.saving = null;
    this.checkpointVersion = 0;
    this.durablePending = 0;
    this.reservedHigh = 0;
    this.lastTelemetry = 0;
    this.metadataChain = Promise.resolve();
    this.retired = false;
    this.telemetry = {
      snapshots: 0,
      bytes: 0,
      authFailures: 0,
      eventGaps: 0,
      persistenceErrors: 0,
      persistMs: 0,
      reconnects: 0,
      snapshotBytes: 0,
      maxSnapshotBytes: 0,
    };
  }
  log(kind, values = {}) {
    console.log(
      JSON.stringify({
        component: "multiplayer",
        kind,
        code: this.code,
        ...values,
      }),
    );
  }
  async load(code) {
    if (this.loaded) return this.loaded;
    this.code = code;
    this.loaded = (async () => {
      const saved = await this.ctx.storage.get("room-state");
      if (saved?.room) this.room = saved.room;
      else {
        const row = await this.env.DB?.prepare(
          "SELECT state FROM game_rooms WHERE code = ?",
        )
          .bind(code)
          .first();
        if (!row)
          throw Object.assign(Error("Room not found. Check the code."), {
            status: 404,
          });
        this.room = JSON.parse(row.state);
        if (this.room.game?.active && !this.room.game.players)
          throw Object.assign(
            Error("This run can no longer be recovered. Create a new room."),
            { status: 410 },
          );
      }
      this.retired = false;
      this.sim = new RoomSimulation(this.room, saved || {});
      this.sim.eventSerial = Math.max(
        this.sim.eventSerial,
        (await this.ctx.storage.get("event-high")) || 0,
      );
      this.reservedHigh = this.sim.eventSerial + 65536;
      await this.ctx.storage.put("event-high", this.reservedHigh);
      this.checkpointVersion = saved?.checkpointVersion || 0;
      for (const socket of this.ctx.getWebSockets("transport")) {
        const a = socket.deserializeAttachment();
        if (a?.id && !a.closed && socket.readyState === WebSocket.OPEN) {
          const member = this.room.members.find((m) => m.id === a.id);
          if (
            !member ||
            (member.disconnected && member.graceUntil < Date.now())
          ) {
            socket.serializeAttachment({ code, closed: true });
            socket.close(4008, "Session expired");
            continue;
          }
          Object.assign(a, {
            controller: crypto.randomUUID(),
            ack: 0,
            sent: 0,
            eventAck: 0,
            lastAck: Date.now(),
            rtt: 0,
            probe: null,
            probeAt: 0,
          });
          socket.serializeAttachment(a);
          this.controllers.set(a.id, a.controller);
          this.sim.touch(a.id, Date.now());
        }
      }
    })();
    try {
      await this.loaded;
    } catch (e) {
      this.loaded = null;
      throw e;
    }
  }
  auth(body) {
    protocol(body.version);
    const m = this.room.members.find(
      (m) => m.id === body.id && m.token === body.token,
    );
    if (!m || (m.disconnected && Date.now() > m.graceUntil))
      throw Object.assign(Error("Session expired. Join a new lobby."), {
        status: 401,
      });
    return m;
  }
  async fetch(request) {
    const url = new URL(request.url),
      code = (url.searchParams.get("code") || "").toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code))
      return Response.json(
        { error: "Enter a valid room code." },
        { status: 400 },
      );
    try {
      await this.load(code);
      if (request.method === "POST") {
        const body = await readBody(request);
        protocol(body.version);
        const now = Date.now();
        this.sim.expire(now);
        if (body.action === "join") {
          if (this.room.game)
            throw Object.assign(Error("This room is already in a run."), {
              status: 409,
            });
          if (this.room.members.length >= 4)
            throw Object.assign(Error("This room is full (4 players)."), {
              status: 409,
            });
          const m = member(body.name, body.weapon, now);
          m.slot =
            [0, 1, 2, 3].find(
              (s) => !this.room.members.some((p) => p.slot === s),
            ) ?? 0;
          this.room.members.push(m);
          this.sim.touch(m.id, now);
          this.sim.host();
          await this.persist(true);
          for (const s of this.ctx.getWebSockets("transport"))
            this.sendSnapshot(s);
          return Response.json(
            {
              ...this.snapshot(
                m.id,
                integer(body.eventAck) ? body.eventAck : 0,
              ),
              session: { id: m.id, token: m.token },
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        const m = this.auth(body);
        this.limit(m.id, now);
        const existing = this.controllers.get(m.id);
        if (body.action === "resume") {
          this.sim.barrier();
          this.sim.neutral(m.id);
          this.sim.touch(m.id, now);
        } else if (body.action === "input") {
          // An HTTP controller may not override an authenticated live WebSocket.
          if (existing && body.controller !== existing)
            throw Object.assign(Error("Another controller is active."), {
              status: 409,
            });
          this.sim.touch(m.id, now);
          this.sim.receive(m.id, body, now);
          this.sim.tryCompensate(
            m.id,
            (id, m) => this.validateView(id, m),
            now,
          );
        } else if (!["poll", "resume"].includes(body.action)) {
          if (existing && body.controller !== existing)
            throw Object.assign(Error("Another controller is active."), {
              status: 409,
            });
          this.limit("action:" + m.id, now);
          this.sim.touch(m.id, now);
          this.sim.action(m.id, body, now, {
            allowAdmin: this.env.ENABLE_DEV_TOOLS === "true",
          });
          await this.persist(true);
        } else this.sim.touch(m.id, now);
        this.sim.host();
        this.ensureLoop();
        if (!["input", "poll"].includes(body.action))
          for (const s of this.ctx.getWebSockets("transport"))
            this.sendSnapshot(s);
        if (body.action === "leave") {
          await this.armAlarm();
          return Response.json({ left: true });
        }
        if (this.durablePending) {
          await this.saving;
          await this.ctx.storage.sync();
        }
        return Response.json(
          this.snapshot(m.id, integer(body.eventAck) ? body.eventAck : 0),
          {
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return Response.json({ error: "WebSocket required." }, { status: 426 });
      if (
        this.ctx
          .getWebSockets("transport")
          .filter((s) => !s.deserializeAttachment()?.closed).length >=
        NET.maxSockets
      )
        return Response.json(
          { error: "Too many room connections. Retry shortly." },
          { status: 429 },
        );
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], ["transport"]);
      pair[1].serializeAttachment({ code, deadline: Date.now() + NET.authMs });
      await this.ctx.storage.put("room-code", code);
      const scheduled = await this.ctx.storage.getAlarm();
      if (scheduled === null || scheduled > Date.now() + NET.authMs)
        await this.ctx.storage.setAlarm(Date.now() + NET.authMs);
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch (e) {
      return Response.json({ error: e.message }, { status: e.status || 400 });
    }
  }
  limit(id, now) {
    let bucket = this.rates.get(id);
    if (!bucket) {
      if (this.rates.size >= 16)
        this.rates.delete(this.rates.keys().next().value);
      this.rates.set(
        id,
        (bucket = new TokenBucket(
          id.startsWith("action:") ? 4 : 60,
          id.startsWith("action:") ? 8 : 120,
        )),
      );
    }
    if (!bucket.take(now))
      throw Object.assign(Error("Too many room messages."), { status: 429 });
  }
  async webSocketMessage(socket, raw) {
    try {
      if (
        typeof raw !== "string" ||
        new TextEncoder().encode(raw).byteLength > NET.maxMessage
      )
        throw Object.assign(Error("Invalid or oversized room message."), {
          fatal: true,
        });
      const body = JSON.parse(raw);
      let a = socket.deserializeAttachment();
      await this.load(a.code);
      a = socket.deserializeAttachment();
      if (a.closed)
        throw Object.assign(Error("Controller expired."), { fatal: true });
      protocol(body.version);
      const now = Date.now();
      this.sim.expire(now);
      if (body.type === "auth") {
        if (a.id)
          throw Object.assign(Error("Already authenticated."), { fatal: true });
        if (now > a.deadline && !a.id)
          throw Object.assign(Error("Authentication timed out."), {
            fatal: true,
          });
        const m = this.auth(body);
        this.limit("auth", now);
        if (m.disconnected || this.controllers.has(m.id))
          this.telemetry.reconnects++;
        const controller = crypto.randomUUID();
        this.sim.barrier();
        this.sim.neutral(m.id);
        this.receipts.delete(this.controllers.get(m.id));
        this.controllers.set(m.id, controller);
        for (const old of this.ctx.getWebSockets("transport"))
          if (old !== socket && old.deserializeAttachment()?.id === m.id) {
            old.serializeAttachment({
              ...old.deserializeAttachment(),
              closed: true,
            });
            old.close(4009, "Controller replaced");
          }
        socket.serializeAttachment({
          code: a.code,
          id: m.id,
          controller,
          ack: 0,
          eventAck: 0,
          lastAck: now,
          sent: 0,
          rtt: 0,
        });
        this.sim.touch(m.id, now);
        this.sim.inputAt[m.id] = now;
        this.sim.host();
        this.ensureLoop();
        await this.persist(true);
        this.sendSnapshot(socket, true);
        return;
      }
      if (!a.id || this.controllers.get(a.id) !== a.controller)
        throw Object.assign(Error("Controller expired."), { fatal: true });
      const m = this.room.members.find((m) => m.id === a.id);
      if (!m) throw Object.assign(Error("Session expired."), { fatal: true });
      this.limit(m.id, now);
      this.sim.touch(m.id, now);
      if (
        integer(body.snapshotAck) &&
        body.snapshotAck <= a.sent &&
        body.snapshotAck > (a.ack || 0)
      ) {
        a.ack = body.snapshotAck;
        a.lastAck = now;
      }
      if (integer(body.eventAck) && body.eventAck <= this.sim.eventSerial)
        a.eventAck = Math.max(a.eventAck || 0, body.eventAck);
      if (body.type === "input") {
        this.sim.receive(m.id, body, now);
        this.sim.tryCompensate(m.id, (id, m) => this.validateView(id, m), now);
      } else if (body.type === "action") {
        this.limit("action:" + m.id, now);
        const result = this.sim.action(m.id, body, now, {
          allowAdmin: this.env.ENABLE_DEV_TOOLS === "true",
        });
        await this.persist(true);
        this.send(socket, {
          type: "actionAck",
          version: NET.version,
          ...result,
        });
      } else if (body.type === "ping") {
        if (!Number.isFinite(body.sentAt)) throw Error("Invalid ping.");
        this.send(socket, {
          type: "pong",
          version: NET.version,
          sentAt: body.sentAt,
          serverTime: now,
          tick: this.sim.tick,
        });
      } else if (body.type === "probeReply") {
        if (body.nonce === a.probe && a.probeAt && now - a.probeAt < 2000) {
          const sample = now - a.probeAt;
          a.rtt = a.rtt ? Math.max(sample, a.rtt * 0.8 + sample * 0.2) : sample;
          a.probe = null;
        }
      } else if (body.type !== "ack") throw Error("Unknown message type.");
      socket.serializeAttachment(a);
      this.ensureLoop();
      if (body.type === "action")
        for (const s of this.ctx.getWebSockets("transport"))
          this.sendSnapshot(s);
    } catch (e) {
      const fatal = !!e.fatal || e.status === 401 || e.status === 426;
      if (fatal) {
        this.telemetry.authFailures++;
        this.log("auth_failure", { status: e.status || 400 });
      }
      this.send(socket, {
        type: "error",
        version: NET.version,
        message: e.message,
        status: e.status || 400,
        actionId: typeof raw === "string" ? this.safeActionId(raw) : undefined,
        fatal,
      });
      if (e.status === 409 && this.isController(socket)) {
        this.sendSnapshot(socket);
        this.ensureLoop();
      }
      if (fatal) socket.close(4008, "Session rejected");
    }
  }
  safeActionId(raw) {
    try {
      return JSON.parse(raw).actionId;
    } catch {
      return undefined;
    }
  }
  validateView(id, message) {
    const controller = this.controllers.get(id),
      receipts = this.receipts.get(controller),
      receipt = receipts?.get(message.viewSequence),
      socket = this.ctx
        .getWebSockets("transport")
        .find((s) => s.deserializeAttachment()?.controller === controller),
      a = socket?.deserializeAttachment();
    if (
      !receipt ||
      Date.now() - receipt.at > 200 ||
      !integer(message.viewTick) ||
      !a?.rtt
    )
      return null;
    const budget = Math.min(
      NET.rewindTicks,
      Math.ceil((a.rtt + 85) / (1000 / NET.hz)),
    );
    if (
      message.viewTick < receipt.tick - 5 ||
      message.viewTick > receipt.tick ||
      this.sim.tick - message.viewTick > budget ||
      this.sim.tick - message.viewTick < 0
    ) {
      this.sim.metrics.rejectedRewinds++;
      return null;
    }
    return message.viewTick;
  }
  ensureLoop() {
    if (Date.now() - this.lastMetadata >= 60000) {
      this.lastMetadata = Date.now();
      this.ctx.waitUntil(
        this.metadata().catch((e) =>
          this.log("metadata_error", { message: e.message }),
        ),
      );
    }
    if (this.timer || !this.room.game) return;
    this.sim.lastWall = Date.now();
    const pump = () => {
      this.timer = null;
      const now = Date.now();
      try {
        this.sweepSockets(now);
        if (
          !["death", "victory"].includes(this.room.game?.phase) ||
          now - this.sim.transitionAt < 250
        )
          this.sim.advance(now);
        else {
          this.sim.barrier();
          this.sim.settleInputs();
          this.sim.lastWall = now;
          this.sim.expire(now);
        }
        this.sim.installPending((id, m) => this.validateView(id, m));
        if (this.sim.critical) {
          this.sim.critical = false;
          this.ctx.waitUntil(
            this.persist(true).catch(() => {
              this.sim.critical = true;
            }),
          );
        }
        if (now - this.lastTelemetry >= 30000) {
          this.lastTelemetry = now;
          this.log("room_metrics", { ...this.sim.metrics, ...this.telemetry });
        }
        if (now - this.lastBroadcast >= NET.snapshotMs) {
          this.lastBroadcast = now;
          for (const s of this.ctx.getWebSockets("transport"))
            if (this.isController(s)) this.sendSnapshot(s);
        }
        if (now - this.lastSave >= NET.checkpointMs) {
          this.lastSave = now;
          this.ctx.waitUntil(this.persist(false).catch(() => {}));
        }
        if (now - this.lastMetadata >= 60000) {
          this.lastMetadata = now;
          this.ctx.waitUntil(
            this.metadata().catch((e) =>
              this.log("metadata_error", { message: e.message }),
            ),
          );
        }
      } catch (e) {
        this.log("tick_error", { message: e.message });
      }
      if (!this.room.game) {
        this.ctx.waitUntil(this.armAlarm());
        return;
      }
      const live = this.room.members.some(
        (m) => !m.disconnected && now - m.lastSeen < NET.watchdogMs,
      );
      if (live)
        this.timer = setTimeout(
          pump,
          ["death", "victory"].includes(this.room.game?.phase) &&
            now - this.sim.transitionAt >= 250
            ? 500
            : 1000 / NET.hz,
        );
      else {
        for (const socket of this.ctx.getWebSockets("transport"))
          if (this.isController(socket))
            this.closeController(socket, "Controller heartbeat timed out");
        for (const m of this.room.members)
          if (!m.disconnected) this.sim.disconnect(m.id, now);
        this.ctx.waitUntil(this.persist(true));
        this.ctx.storage.setAlarm(now + NET.graceMs);
      }
    };
    this.timer = setTimeout(pump, 1000 / NET.hz);
  }
  isController(socket) {
    const a = socket.deserializeAttachment();
    return (
      a?.id &&
      this.controllers.get(a.id) === a.controller &&
      socket.readyState === WebSocket.OPEN
    );
  }
  snapshot(id, eventAck = 0) {
    const sim = this.sim,
      state = publicRoom(this.code, this.room, this.checkpointVersion),
      game = compactGame(state.game);
    const retained = sim.events.filter(
      (e) => Date.now() - (e.emittedAt || 0) <= 2000,
    );
    let events = retained.filter((e) => e.id > eventAck);
    const floor = retained[0]?.id || sim.eventSerial + 1;
    const eventGap = eventAck < floor - 1;
    if (eventGap) this.telemetry.eventGaps++;
    events = events.slice(0, NET.eventBatch);
    if (game) game.events = events;
    return {
      ...state,
      game,
      version: NET.version,
      runId: sim.runId,
      epoch: sim.epoch,
      tick: sim.tick,
      serverTime: Date.now(),
      sequence: ++this.sequence,
      ack: sim.acks[id] || 0,
      inputSequence: sim.received[id] || 0,
      actionSequence: sim.actionSequences[id] || 0,
      settled: Date.now() - sim.transitionAt >= 200,
      correction: sim.correction,
      eventGap,
      eventFloor: floor,
      metrics: { ...sim.metrics, ...this.telemetry },
    };
  }
  sendSnapshot(socket, force = false) {
    if (
      !this.isController(socket) ||
      this.durablePending ||
      this.sim.eventSerial >= this.reservedHigh
    )
      return;
    const a = socket.deserializeAttachment(),
      now = Date.now();
    // At most four unacknowledged snapshots per receiver; never queue intermediates.
    if (
      !force &&
      [...(this.receipts.get(a.controller)?.keys() || [])].filter(
        (seq) => seq > a.ack,
      ).length >= NET.inflight
    ) {
      if (now - a.lastAck > NET.watchdogMs) {
        this.log("slow_client");
        this.closeController(socket, "Snapshot acknowledgments timed out");
      }
      return;
    }
    const message = { type: "snapshot", ...this.snapshot(a.id, a.eventAck) };
    a.sent = message.sequence;
    // Count actual outstanding receipts, not global sequence differences across players.
    let receipts = this.receipts.get(a.controller);
    if (!receipts) this.receipts.set(a.controller, (receipts = new Map()));
    // Keep acknowledged receipts for timestamp validation (bounded to 64).
    receipts.set(message.sequence, { tick: message.tick, at: now });
    if (receipts.size > 64) receipts.delete(receipts.keys().next().value);
    if (!a.probeAt || now - a.probeAt > 2000) {
      a.probe = crypto.randomUUID();
      a.probeAt = now;
      message.probe = a.probe;
    }
    message.controller = a.controller;
    socket.serializeAttachment(a);
    this.send(socket, message);
    this.telemetry.snapshots++;
    const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    this.telemetry.snapshotBytes += bytes;
    this.telemetry.maxSnapshotBytes = Math.max(
      this.telemetry.maxSnapshotBytes,
      bytes,
    );
  }
  send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        const encoded = JSON.stringify(message);
        this.telemetry.bytes += new TextEncoder().encode(encoded).byteLength;
        socket.send(encoded);
      } catch {
        socket.close(1011, "Transport failed");
      }
    }
  }
  closeController(socket, reason) {
    const a = socket.deserializeAttachment();
    if (a?.id && this.controllers.get(a.id) === a.controller) {
      this.controllers.delete(a.id);
      this.receipts.delete(a.controller);
      this.sim.disconnect(a.id, Date.now());
    }
    socket.serializeAttachment({ code: this.code, closed: true });
    socket.close(1013, reason);
    this.ctx.waitUntil(this.persist(true).catch(() => {}));
  }
  async webSocketClose(socket) {
    try {
      let a = socket.deserializeAttachment();
      if (a?.code) {
        await this.load(a.code);
        a = socket.deserializeAttachment();
        if (
          a.id &&
          !a.closed &&
          (!this.controllers.has(a.id) ||
            this.controllers.get(a.id) === a.controller)
        ) {
          this.controllers.delete(a.id);
          this.receipts.delete(a.controller);
          this.sim.disconnect(a.id, Date.now());
          await this.persist(true);
          await this.armAlarm();
        }
      }
    } catch (e) {
      this.log("close_state_error", { status: e.status || 500 });
    }
    try {
      socket.close(1000, "Closed");
    } catch {}
  }
  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
  sweepSockets(now) {
    for (const s of this.ctx.getWebSockets("transport")) {
      const a = s.deserializeAttachment();
      if (!a?.id && a.deadline <= now) {
        s.serializeAttachment({ code: this.code, closed: true });
        s.close(4008, "Authentication timed out");
      }
    }
  }
  async armAlarm() {
    if (!this.room.members.length) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return;
    }
    const deadlines = this.room.members
      .filter((m) => m.disconnected)
      .map((m) => m.graceUntil);
    if (deadlines.length) {
      const at = Math.max(Date.now() + 1, Math.min(...deadlines)),
        scheduled = await this.ctx.storage.getAlarm();
      if (scheduled === null || scheduled > at)
        await this.ctx.storage.setAlarm(at);
    }
  }
  async alarm() {
    await this.load(this.code || (await this.ctx.storage.get("room-code")));
    const now = Date.now();
    this.sweepSockets(now);
    this.sim.expire(now);
    if (!this.room.members.length) {
      clearTimeout(this.timer);
      this.timer = null;
      this.retired = true;
      await this.metadataChain.catch(() => {});
      await this.env.DB?.prepare("DELETE FROM game_rooms WHERE code = ?")
        .bind(this.code)
        .run();
      await this.ctx.storage.deleteAll();
      this.room = null;
      this.sim = null;
      this.loaded = null;
      return;
    }
    await this.persist(true);
    await this.metadata();
    const deadlines = [
      ...this.ctx
        .getWebSockets("transport")
        .map((s) => s.deserializeAttachment())
        .filter((a) => !a?.id && a.deadline > now)
        .map((a) => a.deadline),
      ...this.room.members
        .filter((m) => m.disconnected && m.graceUntil > now)
        .map((m) => m.graceUntil),
    ];
    if (deadlines.length)
      await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  async metadata() {
    if (!this.env.DB || this.retired) return;
    this.metadataChain = this.metadataChain
      .catch(() => {})
      .then(async () => {
        if (this.retired || !this.room) return;
        const state = JSON.stringify({
          ...this.room,
          game: this.room.game ? { active: true } : null,
          inputs: {},
        });
        await this.env.DB.prepare(
          "INSERT INTO game_rooms(code,state,revision,updated_at) VALUES(?,?,0,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
        )
          .bind(this.code, state, Date.now())
          .run();
      });
    return this.metadataChain;
  }
  async writeCheckpoint(value, allowUnconfirmed) {
    if (this.sim.eventSerial > this.reservedHigh - 8192) {
      this.reservedHigh += 65536;
      await this.ctx.storage.put("event-high", this.reservedHigh);
    }
    await this.ctx.storage.put(
      { "room-state": value, "room-code": this.code },
      { allowUnconfirmed },
    );
  }
  async persist(force = false) {
    if (force) this.durablePending++;
    try {
      this.savePending = clone({
        ...this.sim.checkpoint(),
        checkpointVersion: ++this.checkpointVersion,
      });
      if (!this.saving)
        this.saving = (async () => {
          try {
            while (this.savePending) {
              const value = this.savePending;
              this.savePending = null;
              const start = Date.now();
              try {
                await this.writeCheckpoint(value, !force);
                this.telemetry.persistMs = Date.now() - start;
              } catch (e) {
                this.telemetry.persistenceErrors++;
                this.log("persistence_error", { message: e.message });
                throw e;
              }
            }
          } finally {
            this.saving = null;
          }
        })();
      await this.saving;
      if (force) await this.ctx.storage.sync();
    } finally {
      if (force) this.durablePending--;
    }
  }
}
