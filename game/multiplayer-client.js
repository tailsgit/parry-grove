import { NET, clone } from "./net-protocol.js";
import { stepPlayer } from "./engine.js";
const SESSION_KEY = "parry-grove-session-v2";
export function savedSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s?.version === NET.version &&
      typeof s.code === "string" &&
      typeof s.id === "string" &&
      typeof s.token === "string"
      ? s
      : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}
export class MultiplayerClient {
  constructor(session, hooks) {
    this.session = session;
    Object.assign(this, session);
    this.hooks = hooks;
    this.socket = null;
    this.stopped = false;
    this.authenticated = false;
    this.sequence = 0;
    this.ack = 0;
    this.eventAck = 0;
    this.snapAck = 0;
    this.socketAck = 0;
    this.actionSeq = 0;
    this.frames = [];
    this.history = [];
    this.pendingActions = new Map();
    this.events = new Map();
    this.lastPacket = performance.now();
    this.lastSnapshot = this.lastPacket;
    this.retry = 250;
    this.correctionOffset = { x: 0, y: 0 };
    this.metrics = {
      corrections: 0,
      maxCorrection: 0,
      confirmationMs: [],
      inputConfirmationMs: [],
      reconnects: 0,
      eventGaps: 0,
    };
    this.nextHttp = 0;
    this.retryAt = 0;
    this.pingAt = 0;
    this.frameAccumulator = 0;
    this.clockSamples = [];
    this.startups = {};
    this.startupParry = 0;
    this.rtt = 0;
    this.interpolationMs = 50;
    this.snapshotIntervals = [];
    this.offset = 0;
    this.timer = null;
  }
  async start(initial) {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...this.session, version: NET.version }),
      );
    } catch {}
    if (initial) this.accept(initial);
    else {
      try {
        this.accept(await this.http({ action: "resume" }));
      } catch (e) {
        if ([401, 404, 410, 426].includes(e.status)) {
          this.invalidate(e.message);
          throw e;
        }
        this.hooks.onError("Recovering connection…");
      }
    }
    this.open();
    this.timer = setInterval(() => this.pump(), NET.inputMs);
    return this;
  }
  async http(body) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...this.session,
          version: NET.version,
          controller: this.controller,
          ...body,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw Object.assign(Error(data.error || "Room request failed."), {
          status: response.status,
        });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  open() {
    if (this.stopped) return;
    this.lastPacket = performance.now();
    this.authenticated = false;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/room/socket?code=${this.session.code}`,
    );
    this.socket = socket;
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "auth",
          version: NET.version,
          id: this.session.id,
          token: this.session.token,
        }),
      );
    socket.onmessage = (e) => {
      if (this.socket !== socket) return;
      try {
        const m = JSON.parse(e.data);
        this.lastPacket = performance.now();
        if (m.type === "snapshot") {
          this.authenticated = true;
          this.retry = 250;
          this.accept(m);
          if (!this.stopped) this.hooks.onError("");
          if (m.probe) this.send({ type: "probeReply", nonce: m.probe });
        } else if (m.type === "pong") {
          const now = performance.now(),
            rtt = now - m.sentAt;
          if (rtt >= 0 && rtt < 2000) {
            this.clockSamples.push({
              rtt,
              offset: m.serverTime - (m.sentAt + now) / 2,
            });
            if (this.clockSamples.length > 12) this.clockSamples.shift();
            const best = [...this.clockSamples].sort(
              (a, b) => a.rtt - b.rtt,
            )[0];
            this.offset = best.offset;
            this.rtt = rtt;
            this.hooks.onLatency?.(Math.round(rtt));
          }
        } else if (m.type === "actionAck") this.finishAction(m.actionId);
        else if (m.type === "error") {
          const action = this.pendingActions.get(m.actionId);
          if (action && ![409, 425, 429].includes(m.status)) {
            this.pendingActions.delete(m.actionId);
            action.reject(Error(m.message));
          }
          this.hooks.onError(m.message);
          if (m.fatal) {
            socket.close(4008, "Session rejected");
            this.invalidate();
          }
        }
      } catch (error) {
        this.hooks.onError(error.message);
      }
    };
    socket.onerror = () =>
      this.hooks.onError("Connection interrupted. Reconnecting…");
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authenticated = false;
      if (this.stopped) return;
      if (e.code === 4009) {
        this.invalidate("This player is controlled by another connection.");
        return;
      }
      if (e.code === 4008) {
        this.invalidate("Session expired. Join a new lobby.");
        return;
      }
      this.metrics.reconnects++;
      this.retryAt = performance.now() + this.retry;
      this.retry = Math.min(4000, this.retry * 2);
      this.hooks.onError("Reconnecting…");
    };
  }
  invalidate(message) {
    clearSession();
    this.stop();
    this.hooks.onInvalid?.(message || "Session expired.");
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.socket?.close(1000, "Leaving");
    for (const a of this.pendingActions.values())
      a.reject(Error("Connection closed."));
    this.pendingActions.clear();
  }
  viewFrame(now = performance.now()) {
    const target = now + this.offset - this.interpolationMs - this.rtt / 2;
    let a = this.history[0],
      b = this.history.at(-1);
    for (const h of this.history) {
      if (h.serverTime <= target) a = h;
      if (h.serverTime >= target) {
        b = h;
        break;
      }
    }
    const t =
      a && b && b.serverTime > a.serverTime
        ? Math.max(
            0,
            Math.min(
              1,
              (target - a.serverTime) / (b.serverTime - a.serverTime),
            ),
          )
        : 1;
    return {
      a,
      b,
      t,
      tick: (a?.tick || 0) + ((b?.tick || 0) - (a?.tick || 0)) * t,
    };
  }
  metadata() {
    const newest = this.viewSnapshot || this.history.at(-1),
      frame = this.viewFrame();
    return {
      runId: this.runId,
      epoch: this.epoch,
      snapshotAck: this.socketAck,
      eventAck: this.eventAck,
      viewSequence: newest?.sequence,
      viewTick: Math.max(
        0,
        Math.min(newest?.tick || 0, Math.floor(frame.tick)),
      ),
    };
  }
  send(body) {
    if (this.socket?.readyState === WebSocket.OPEN && this.authenticated) {
      this.socket.send(
        JSON.stringify({ version: NET.version, ...this.metadata(), ...body }),
      );
      this.lastAckSent = this.socketAck;
      return true;
    }
    return false;
  }
  pump() {
    if (this.stopped) return;
    const now = performance.now();
    if (now - this.lastPacket > NET.watchdogMs) {
      this.authenticated = false;
      this.socket?.close(4000, "Server heartbeat timed out");
      this.hooks.onError("Connection stalled. Reconnecting…");
    }
    if (!this.socket && now >= this.retryAt) this.open();
    if (now - this.pingAt > 1000) {
      this.pingAt = now;
      this.send({ type: "ping", sentAt: now });
    }
    const commands = this.frames
      .filter((f) => f.seq > this.ack)
      .slice(-12)
      .map(({ seq, input, viewTick, viewSequence }) => ({
        seq,
        input,
        viewTick,
        viewSequence,
      }));
    if (commands.length && this.game) {
      if (!this.send({ type: "input", commands }))
        this.fallback({
          action: "input",
          ...this.metadata(),
          commands,
          controller: this.controller,
        });
    } else if (this.socketAck !== this.lastAckSent) this.send({ type: "ack" });
    if (!this.game && !this.authenticated && now >= this.nextHttp)
      this.fallback({ action: "poll" });
    for (const a of this.pendingActions.values())
      if (now - a.sent > 700) {
        a.sent = now;
        if (!this.send({ type: "action", ...a.body }))
          this.fallback(a.body, true);
      }
  }
  async fallback(body, action = false) {
    if ((this.httpBusy && !action) || this.stopped) return;
    this.httpBusy = true;
    this.nextHttp = performance.now() + 400;
    try {
      const data = await this.http(body);
      if (this.stopped) return;
      if (action) this.finishAction(body.actionId);
      this.accept(data);
      if (!this.authenticated)
        this.hooks.onError("HTTP fallback · reduced responsiveness");
    } catch (e) {
      if ([401, 404, 410, 426].includes(e.status)) this.invalidate(e.message);
      else if (![409, 425, 429].includes(e.status))
        this.hooks.onError(e.message);
    } finally {
      this.httpBusy = false;
    }
  }
  action(action, extra = {}) {
    const actionId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (this.pendingActions.size >= 16) {
        reject(Error("Too many pending actions."));
        return;
      }
      const body = {
        action,
        ...extra,
        actionId,
        actionSeq: ++this.actionSeq,
        runId: this.runId,
      };
      this.pendingActions.set(actionId, {
        body,
        resolve,
        reject,
        sent: -Infinity,
        started: performance.now(),
      });
      this.pump();
    });
  }
  finishAction(id) {
    const a = this.pendingActions.get(id);
    if (a) {
      this.pendingActions.delete(id);
      this.metrics.confirmationMs.push(performance.now() - a.started);
      if (this.metrics.confirmationMs.length > 60)
        this.metrics.confirmationMs.shift();
      a.resolve();
    }
  }
  accept(data) {
    if (data.version !== NET.version) {
      this.invalidate("Game updated. Refresh to reconnect.");
      return;
    }
    if (data.code !== this.session.code) return;
    if (data.type === "snapshot") {
      this.socketAck = data.sequence;
      this.viewSnapshot = data;
    }
    const reset = data.runId !== this.runId || data.epoch !== this.epoch;
    if (!reset && data.sequence <= this.snapAck) return;
    const now = performance.now();
    if (reset) {
      this.frames = [];
      this.history = [];
      this.socketAck = data.type === "snapshot" ? data.sequence : 0;
      this.viewSnapshot = data.type === "snapshot" ? data : null;
      this.events.clear();
      this.eventAck = 0;
      this.startups = {};
      this.sequence = data.inputSequence || 0;
      this.frameAccumulator = 0;
      this.predicted = null;
      this.correctionOffset = { x: 0, y: 0 };
      const hero = data.game?.players.find((p) => p.id === this.session.id);
      this.hooks.syncInput?.(hero);
    }
    this.actionSeq = Math.max(this.actionSeq, data.actionSequence || 0);
    this.settled = data.settled;
    this.runId = data.runId;
    this.epoch = data.epoch;
    this.controller = data.controller || this.controller;
    this.snapAck = data.sequence;
    this.ack = data.ack;
    for (const f of this.frames)
      if (f.seq <= this.ack && f.at) {
        this.metrics.inputConfirmationMs.push(now - f.at);
        if (this.metrics.inputConfirmationMs.length > 120)
          this.metrics.inputConfirmationMs.shift();
      }
    this.frames = this.frames.filter((f) => f.seq > this.ack);
    this.snapshotIntervals.push(now - this.lastSnapshot);
    if (this.snapshotIntervals.length > 20) this.snapshotIntervals.shift();
    const recent = this.snapshotIntervals.slice(1),
      mean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1),
      jitter = Math.sqrt(
        recent.reduce((a, b) => a + (b - mean) ** 2, 0) / (recent.length || 1),
      );
    this.interpolationMs = Math.max(33, Math.min(83, mean + jitter));
    if (!this.clockSamples.length) this.offset = data.serverTime - now;
    this.lastSnapshot = now;
    this.lastPacket = now;
    this.history.push({ ...data, at: now });
    if (this.history.length > 12) this.history.shift();
    if (data.eventGap) {
      this.metrics.eventGaps++;
      this.events.clear();
      this.eventAck = Math.max(this.eventAck, data.eventFloor - 1);
    }
    for (const e of data.game?.events || [])
      if (e.id > this.eventAck) this.events.set(e.id, e);
    while (this.events.size > 256)
      this.events.delete(this.events.keys().next().value);
    const scene = data.game
      ? [
          data.game.stage,
          data.game.room,
          data.game.combatRoom,
          data.game.stopSerial,
          data.game.phase === "draft" ? "draft" : "run",
        ].join(":")
      : "lobby";
    if (this.scene && this.scene !== scene) {
      this.history = this.history.slice(-1);
      this.predicted = null;
      this.correctionOffset = { x: 0, y: 0 };
      this.hooks.onCorrection?.();
    }
    this.scene = scene;
    this.game = data.game;
    if (this.game) {
      this.game.events = [
        ...(this.eventAck
          ? [{ id: this.eventAck, kind: "cursor", time: this.game.time }]
          : []),
        ...[...this.events.values()].map((e) =>
          e.who === this.session.id &&
          ((e.inputSeq && e.inputSeq <= (this.startups[e.kind] || 0)) ||
            (e.kind === "guard" &&
              e.parryCounter &&
              e.parryCounter <= this.startupParry))
            ? { ...e, kind: "cursor" }
            : e,
        ),
      ];
      const source = this.game.players.find((p) => p.id === this.session.id);
      if (source) {
        const previous = this.predicted;
        this.predicted = clone(source);
        for (const f of this.frames) this.predictFrame(f.input);
        if (
          previous &&
          !reset &&
          data.correction === this.correction &&
          source.hp > 0
        ) {
          const dx = previous.x - this.predicted.x,
            dy = previous.y - this.predicted.y,
            gap = Math.hypot(dx, dy);
          if (gap > 1) {
            this.metrics.corrections++;
            this.metrics.maxCorrection = Math.max(
              this.metrics.maxCorrection,
              gap,
            );
            this.correctionOffset =
              gap < 35 ? { x: dx, y: dy } : { x: 0, y: 0 };
          }
        }
      }
    }
    if (data.correction !== this.correction) {
      this.correctionOffset = { x: 0, y: 0 };
      this.hooks.onCorrection?.();
    }
    this.correction = data.correction;
    this.hooks.onSnapshot(data);
  }
  predictFrame(input, seq) {
    if (
      !this.game ||
      !this.predicted ||
      !["combat", "draft", "shop", "altar", "route"].includes(this.game.phase)
    )
      return;
    const g = {
      ...this.game,
      prediction: true,
      players: [this.predicted],
      enemies: [],
      bullets: [],
      hazards: [],
      events: [],
    };
    const before = {
      dash: this.predicted.dashLeft,
      guard: this.predicted.parryLeft,
      swing: this.predicted.swing,
    };
    stepPlayer(
      g,
      this.predicted,
      input,
      NET.dt,
      this.predicted.vendorOpen || this.predicted.altarOpen,
    );
    if (seq)
      for (const [kind, key] of [
        ["dash", "dashLeft"],
        ["guard", "parryLeft"],
        ["swing", "swing"],
      ])
        if (!before[kind] && this.predicted[key] > 0) {
          this.startups[kind] = seq;
          if (kind === "guard") this.startupParry = input.parry;
          this.hooks.onStartup?.(kind);
        }
  }
  frame(dt, input) {
    if (
      !this.game ||
      this.stopped ||
      (["death", "victory"].includes(this.game.phase) && this.settled)
    )
      return;
    this.frameAccumulator = Math.min(0.1, this.frameAccumulator + dt);
    while (this.frameAccumulator >= NET.dt) {
      this.frameAccumulator -= NET.dt;
      if (this.frames.length >= 24) {
        this.hooks.onError("Waiting for server · controls resynchronizing");
        break;
      }
      const view = this.metadata(),
        f = {
          at: performance.now(),
          seq: ++this.sequence,
          input: { ...input },
          viewTick: view.viewTick,
          viewSequence: view.viewSequence,
        };
      this.frames.push(f);
      this.predictFrame(f.input, f.seq);
    }
    this.correctionOffset.x *= 0.75;
    this.correctionOffset.y *= 0.75;
  }
  display(now, input) {
    if (!this.game) return this.game;
    const { a, b, t } = this.viewFrame(now),
      display = { ...this.game };
    for (const key of ["players", "enemies", "bullets", "hazards"]) {
      const older = new Map((a?.game?.[key] || []).map((v) => [v.id, v])),
        newer = new Map((b?.game?.[key] || []).map((v) => [v.id, v]));
      display[key] = this.game[key].map((v) => {
        const copy = { ...v },
          x = older.get(v.id),
          y = newer.get(v.id);
        if (x && y) {
          for (const f of ["x", "y", "sx", "sy", "ex", "ey"])
            if (Number.isFinite(x[f]) && Number.isFinite(y[f]))
              copy[f] = x[f] + (y[f] - x[f]) * t;
          if (Number.isFinite(x.angle) && Number.isFinite(y.angle))
            copy.angle =
              x.angle +
              Math.atan2(
                Math.sin(y.angle - x.angle),
                Math.cos(y.angle - x.angle),
              ) *
                t;
        }
        if (key === "players" && v.id === this.session.id && this.predicted) {
          Object.assign(copy, this.predicted);
          copy.x += this.correctionOffset.x;
          copy.y += this.correctionOffset.y;
          copy.angle = input.angle;
        }
        return copy;
      });
    }
    return display;
  }
  acknowledgeEvents(last) {
    this.eventAck = Math.max(this.eventAck, last || 0);
    for (const id of this.events.keys())
      if (id <= this.eventAck) this.events.delete(id);
  }
  async leave() {
    clearSession();
    try {
      await this.action("leave");
    } finally {
      this.stop();
    }
  }
}
