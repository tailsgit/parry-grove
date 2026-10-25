import { step } from "./engine.js";
import { applyAction, cleanInput } from "./rooms.js";
import {
  NET,
  clone,
  validateInput,
  integer,
  neutralInput,
  ACTIONS,
} from "./net-protocol.js";
import { HistoryPool, copyState } from "./state-copy.js";
const identity = (g) =>
  g
    ? `${g.runType}:${g.stage}:${g.room}:${g.combatRoom}:${g.stopSerial}`
    : "lobby";
export class RoomSimulation {
  constructor(room, saved = {}, now = Date.now()) {
    this.room = room;
    this.runId = saved.runId || crypto.randomUUID();
    this.epoch = crypto.randomUUID();
    this.tick = saved.tick || 0;
    this.correction = 0;
    this.accumulator = 0;
    this.lastWall = now;
    this.pending = new Map();
    this.queues = new Map();
    this.history = [];
    this.historyPool = new HistoryPool();
    this.actions = saved.actions || {};
    this.actionSequences = saved.actionSequences || {};
    this.acks = {};
    this.received = {};
    this.inputAt = {};
    this.traces = {};
    this.events = [];
    this.eventKeys = new Map();
    this.eventSerial = saved.eventSerial || 0;
    this.transitionAt = 0;
    this.critical = false;
    this.compensated = {};
    this.lastRewindTick = {};
    this.metrics = {
      ticks: 0,
      overruns: 0,
      droppedMs: 0,
      rewinds: 0,
      replayedTicks: 0,
      rejectedRewinds: 0,
      staleInputs: 0,
      inputCoalesced: 0,
      tickMs: 0,
      maxTickMs: 0,
    };
    for (const m of room.members) {
      const deadline =
        m.disconnected && m.graceUntil ? m.graceUntil : now + NET.graceMs;
      m.disconnected = true;
      m.graceUntil = deadline;
      this.neutral(m.id);
      const p = room.game?.players.find((p) => p.id === m.id);
      if (p) p.disconnected = true;
    }
  }
  neutral(id) {
    const p = this.room.game?.players.find((p) => p.id === id),
      latest =
        this.pending.get(id)?.at(-1)?.input ||
        this.queues.get(id)?.at(-1)?.input ||
        this.room.inputs[id],
      i = neutralInput(p, latest);
    this.room.inputs[id] = i;
    this.acks[id] = this.received[id] || this.acks[id] || 0;
    this.pending.delete(id);
    this.queues.delete(id);
    if (p) {
      p.seenDash = i.dash;
      p.seenParry = i.parry;
      p.seenAttack = i.attackPress;
      p.seenInteract = i.interact;
      p.dashBufferLeft = 0;
      p.parryBufferLeft = 0;
      p.meleeBufferLeft = 0;
      p.guardHeld = false;
      p.blocking = false;
    }
  }
  barrier() {
    for (const h of this.history) {
      this.commitEvents(h.emitted);
      this.historyPool.release(h.game);
    }
    this.history = [];
  }
  commitEvents(events) {
    for (const event of events || []) {
      const key =
        event.tick == null
          ? null
          : JSON.stringify([
              event.tick,
              event.kind,
              event.who,
              event.x,
              event.y,
              event.text,
              event.sourceKind,
              event.fx,
              event.inputSeq,
            ]);
      if (key && this.eventKeys.has(key)) {
        const saved = this.eventKeys.get(key);
        if (!this.events.some((e) => e.id === saved.id))
          this.events.push(saved);
        continue;
      }
      const delivered = {
        ...event,
        id: ++this.eventSerial,
        runId: this.runId,
        emittedAt: event.occurredAt ?? this.lastWall,
      };
      this.events.push(delivered);
      if (key) this.eventKeys.set(key, delivered);
    }
    this.events.sort((a, b) => a.id - b.id);
    if (this.events.length > NET.eventLimit)
      this.events.splice(0, this.events.length - NET.eventLimit);
    while (this.eventKeys.size > 1024)
      this.eventKeys.delete(this.eventKeys.keys().next().value);
  }
  touch(id, now) {
    const m = this.room.members.find((m) => m.id === id);
    if (!m)
      throw Object.assign(Error("Session expired. Join a new lobby."), {
        status: 401,
      });
    m.lastSeen = now;
    m.disconnected = false;
    m.graceUntil = now + NET.graceMs;
    const p = this.room.game?.players.find((p) => p.id === id);
    if (p) p.disconnected = false;
    return m;
  }
  disconnect(id, now) {
    const m = this.room.members.find((m) => m.id === id);
    if (!m) return;
    this.barrier();
    m.disconnected = true;
    m.graceUntil = now + NET.graceMs;
    this.neutral(id);
    const p = this.room.game?.players.find((p) => p.id === id);
    if (p) p.disconnected = true;
    if (this.room.game) this.room.game.doorConsensus = null;
    this.host();
  }
  host() {
    const r = this.room;
    if (!r.members.some((m) => m.id === r.host && !m.disconnected))
      r.host =
        r.members.find((m) => !m.disconnected)?.id || r.members[0]?.id || "";
    if (r.game) r.game.hostId = r.host;
  }
  expire(now) {
    for (const m of [...this.room.members]) {
      if (m.disconnected && now >= m.graceUntil) {
        this.barrier();
        applyAction(this.room, m, { action: "leave" }, now);
        delete this.acks[m.id];
        delete this.received[m.id];
      } else if (
        !m.disconnected &&
        now - (this.inputAt[m.id] ?? m.lastSeen) > NET.silenceMs
      ) {
        this.neutral(m.id);
        this.metrics.staleInputs++;
        this.inputAt[m.id] = now;
      }
    }
    if (!this.room.members.length && this.room.game) {
      this.barrier();
      this.room.game = null;
      this.room.inputs = {};
      this.runId = crypto.randomUUID();
      this.critical = true;
    }
    this.host();
  }
  receive(id, message, now) {
    if (message.runId !== this.runId || message.epoch !== this.epoch)
      throw Object.assign(Error("Run changed. Resynchronize."), {
        status: 409,
      });
    const commands = message.commands || [
      {
        seq: message.seq,
        input: message.input,
        viewTick: message.viewTick,
        viewSequence: message.viewSequence,
      },
    ];
    if (!Array.isArray(commands) || !commands.length || commands.length > 12)
      throw Error("Invalid input batch.");
    const queued = [...(this.pending.get(id) || [])];
    let highest = this.received[id] || 0;
    let previous =
      queued.at(-1)?.input ||
      this.queues.get(id)?.at(-1)?.input ||
      this.room.inputs[id] ||
      {};
    for (const command of commands) {
      validateInput(command.input);
      if (!integer(command.seq, 1)) throw Error("Invalid input sequence.");
      if (command.seq <= highest) continue;
      if (command.seq > highest + 256)
        throw Error("Input sequence too far ahead.");
      const input = cleanInput(command.input);
      for (const key of ["parry", "dash", "attackPress", "interact"])
        if (
          input[key] < (previous[key] || 0) ||
          input[key] - (previous[key] || 0) > 8
        )
          throw Error("Invalid action counter.");
      queued.push({
        ...command,
        input,
        receivedAt: now,
        trace:
          Number.isFinite(command.createdAt) && Number.isFinite(command.sentAt)
            ? {
                seq: command.seq,
                createdAt: command.createdAt,
                sentAt: command.sentAt,
                receivedAt: performance.now(),
              }
            : null,
      });
      highest = command.seq;
      previous = input;
    }
    if (queued.length > 12) throw Error("Input queue full.");
    const fresh = highest > (this.received[id] || 0);
    this.received[id] = highest;
    this.pending.set(id, queued);
    if (fresh) this.inputAt[id] = now;
    return fresh;
  }

  advance(now) {
    const elapsed = Math.max(0, (now - this.lastWall) / 1000);
    this.lastWall = now;
    this.expire(now);
    if (!this.room.game) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += elapsed;
    const maximum = NET.maxCatchup * NET.dt;
    if (this.accumulator > maximum) {
      this.metrics.overruns++;
      this.metrics.droppedMs += (this.accumulator - maximum) * 1000;
      this.accumulator = maximum;
    }
    while (this.accumulator + 1e-9 >= NET.dt) {
      this.oneTick();
      this.accumulator -= NET.dt;
    }
  }
  installPending(validateView) {
    this.validateView = validateView;
    for (const [id, commands] of this.pending) {
      const queue = this.queues.get(id) || [];
      queue.push(...commands);
      if (queue.length > NET.queuedTicks) {
        this.metrics.inputCoalesced += queue.length - NET.queuedTicks;
        queue.splice(0, queue.length - NET.queuedTicks);
      }
      this.queues.set(id, queue);
    }
    this.pending.clear();
  }

  tryCompensate(id, validateView, now = this.lastWall) {
    const message = this.pending
      .get(id)
      ?.find(
        (m) =>
          m.input.parry >
          Math.max(this.room.inputs[id]?.parry || 0, this.compensated[id] || 0),
      );
    if (!message || this.tick - (this.lastRewindTick[id] ?? -100) < 2)
      return false;
    const target = validateView?.(id, message);
    if (target == null || target >= this.tick) return false;
    if (!this.rewind(id, message, target, now)) return false;
    this.compensated[id] = message.input.parry;
    this.lastRewindTick[id] = this.tick;
    return true;
  }
  oneTick() {
    for (const [id, queue] of this.queues) {
      const m = queue.shift();
      if (!m) continue;
      const old = this.room.inputs[id] || {};
      if (m.input.parry > Math.max(old.parry || 0, this.compensated[id] || 0)) {
        const target = this.validateView?.(id, m);
        if (target != null && target < this.tick) this.rewind(id, m, target);
      }
      this.room.inputs[id] = m.input;
      this.acks[id] = m.seq;
      if (m.trace)
        this.traces[id] = { ...m.trace, appliedAt: performance.now() };
    }
    const g = this.room.game;
    if (!g) return;
    const before = performance.now(),
      phase = g.phase,
      key = identity(g),
      last = g.eventSerial;
    const frame = {
      tick: this.tick + 1,
      wall: this.lastWall,
      game: this.historyPool.capture(g),
      inputs: clone(this.room.inputs),
      sequences: clone(this.acks),
      emitted: [],
    };
    g.inputSequences = this.acks;
    step(g, this.room.inputs, NET.dt);
    this.tick++;
    this.metrics.ticks++;
    frame.emitted = clone(g.events.filter((e) => e.id > last)).map((e) => ({
      ...e,
      occurredAt: frame.wall,
      tick: frame.tick,
    }));
    this.history.push(frame);
    // Publish authoritative outcomes now; replay retracts obsolete transient effects.
    this.commitEvents(frame.emitted);
    if (g.phase !== phase) {
      this.transitionAt = this.lastWall;
      this.critical = true;
    }
    if (
      frame.emitted.some((e) =>
        [
          "purchase",
          "kitpickup",
          "sacrifice",
          "upgrade",
          "roomenter",
          "death",
          "victory",
        ].includes(e.kind),
      )
    )
      this.critical = true;
    if (identity(g) !== key) this.barrier();
    while (this.history.length > NET.rewindTicks) {
      const expired = this.history.shift();
      this.historyPool.release(expired.game);
    }
    const ms = performance.now() - before;
    this.metrics.tickMs += ms;
    this.metrics.maxTickMs = Math.max(this.metrics.maxTickMs, ms);
  }
  rewind(id, message, target, now = this.lastWall) {
    const index = this.history.findIndex((h) => h.tick === target + 1),
      p = this.history[index]?.game.players.find((p) => p.id === id);
    if (
      index < 0 ||
      now - this.history[index].wall > 200 ||
      !p ||
      p.hp <= 0 ||
      this.history[index].game.phase !== "combat"
    ) {
      this.metrics.rejectedRewinds++;
      return false;
    }
    // Whole-world replay preserves original engine eligibility, ownership, death,
    // internal damage and streak semantics. No network side effects occur here.
    const frames = this.history.slice(index);
    this.events = this.events.filter(
      (e) => e.tick == null || e.tick < frames[0].tick,
    );
    let g = copyState(frames[0].game);
    for (const frame of frames) {
      frame.game = copyState(g, frame.game, true);
      const input = frame.inputs[id];
      if (input) {
        input.parry = Math.max(input.parry || 0, message.input.parry);
        input.guard = message.input.guard;
        input.angle = message.input.angle;
      }
      const last = g.eventSerial;
      g.inputSequences = frame.sequences;
      step(g, frame.inputs, NET.dt);
      frame.emitted = clone(g.events.filter((e) => e.id > last)).map((e) => ({
        ...e,
        occurredAt: frame.wall,
        tick: frame.tick,
      }));
    }
    for (const frame of frames) this.commitEvents(frame.emitted);
    // Membership is transport state, not something a historical input can rewind.
    for (const p of g.players)
      p.disconnected = !!this.room.members.find((m) => m.id === p.id)
        ?.disconnected;
    if (this.room.game.phase !== g.phase) this.transitionAt = this.lastWall;
    this.room.game = g;
    this.critical = true;
    this.correction++;
    this.metrics.rewinds++;
    this.metrics.replayedTicks += frames.length;
    return true;
  }
  action(id, message, now, authorization) {
    if (!ACTIONS.has(message.action)) throw Error("Unknown room action.");
    if (
      typeof message.actionId !== "string" ||
      !/^[A-Za-z0-9_-]{8,96}$/.test(message.actionId)
    )
      throw Error("Missing action identifier.");
    const key = id + ":" + message.actionId,
      signature = JSON.stringify(
        Object.fromEntries(
          [
            "action",
            "runId",
            "upgrade",
            "weapon",
            "operation",
            "level",
            "room",
            "hp",
            "kit",
            "choice",
            "item",
            "curse",
            "rarity",
            "index",
          ]
            .filter((k) => message[k] !== undefined)
            .map((k) => [k, message[k]]),
        ),
      );
    if (this.actions[key]) {
      if (this.actions[key].signature !== signature)
        throw Error("Action identifier reused.");
      return this.actions[key].result;
    }
    if (message.runId !== this.runId)
      throw Object.assign(Error("Run changed. Resynchronize."), {
        status: 409,
      });
    if (
      !integer(message.actionSeq, 1) ||
      message.actionSeq <= (this.actionSequences[id] || 0)
    )
      throw Error("Action sequence expired. Resynchronize.");
    if (
      ((message.action === "upgrade" && this.room.game?.phase === "upgrade") ||
        (["return", "retry"].includes(message.action) &&
          ["death", "victory"].includes(this.room.game?.phase))) &&
      now - this.transitionAt < (NET.rewindTicks * 1000) / NET.hz
    )
      throw Object.assign(Error("Confirming combat result…"), { status: 425 });
    const m = this.room.members.find((m) => m.id === id);
    if (!m) throw Object.assign(Error("Session expired."), { status: 401 });
    const old = this.room.game,
      last = old?.eventSerial || 0,
      draft = clone(this.room);
    // Validate and apply to a draft before committing the timeline. Rejected
    // actions must not flush another player's eligible parry history.
    applyAction(
      draft,
      draft.members.find((m) => m.id === id),
      message,
      now,
      authorization,
    );
    if (!draft.members.length) {
      draft.game = null;
      draft.inputs = {};
    }
    const reset =
      (!old && !!draft.game) ||
      (!!old && !draft.game) ||
      message.action === "retry";
    this.barrier();
    Object.assign(this.room, draft);
    this.commitEvents(this.room.game?.events.filter((e) => e.id > last));
    for (const key of this.queues.keys())
      if (!this.room.members.some((m) => m.id === key)) {
        this.queues.delete(key);
        this.pending.delete(key);
      }
    if (message.action === "admin" && message.operation === "teleport") {
      for (const m of this.room.members) this.neutral(m.id);
      this.acks = { ...this.received };
      this.correction++;
    }
    if (reset) {
      this.runId = crypto.randomUUID();
      this.history = [];
      this.pending.clear();
      this.queues.clear();
      this.room.inputs = {};
      this.acks = {};
      this.received = {};
      this.traces = {};
      this.compensated = {};
      this.lastRewindTick = {};
      this.events = [];
      this.eventSerial = 0;
      this.eventKeys.clear();
      this.accumulator = 0;
      this.lastWall = now;
    }
    this.actionSequences[id] = message.actionSeq;
    const result = { actionId: message.actionId, accepted: true };
    this.actions[key] = { signature, result };
    const keys = Object.keys(this.actions);
    if (keys.length > 256) delete this.actions[keys[0]];
    return result;
  }
  settleInputs() {
    for (const m of this.room.members) this.neutral(m.id);
    this.acks = { ...this.received };
  }
  checkpoint() {
    return {
      room: this.room,
      runId: this.runId,
      tick: this.tick,
      actions: this.actions,
      actionSequences: this.actionSequences,
      eventSerial: this.eventSerial,
    };
  }
}
