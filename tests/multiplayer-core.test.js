import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomSimulation } from "../game/room-simulation.js";
import { member, roomState } from "../game/rooms.js";
import { createRun } from "../game/run-content.js";
import { player, spawnEnemy } from "../game/engine.js";
import { NET, clone, readBody } from "../game/net-protocol.js";
import { MultiplayerClient } from "../game/multiplayer-client.js";
function setup() {
  const m = member("Tester", "sword", 1000),
    r = roomState(m, 1000);
  r.game = createRun([player(m.id, m.name, m.weapon)], 42);
  r.game.phase = "combat";
  r.game.enemies = [];
  r.game.obstacles = [];
  r.game.intro = 0;
  const p = r.game.players[0];
  p.x = 200;
  p.y = 200;
  p.invuln = 0;
  spawnEnemy(r.game, "bow", 800, 450).cooldown = 100;
  const sim = new RoomSimulation(r, {}, 1000);
  sim.touch(m.id, 1000);
  return { sim, r, p, m };
}
const controls = (sim, seq, input, rest = {}) => ({
  runId: sim.runId,
  epoch: sim.epoch,
  commands: [{ seq, input, ...rest }],
});
test("fixed accumulator advances without input and queued movement never affects elapsed catch-up", () => {
  const { sim, p, m } = setup(),
    x = p.x;
  sim.receive(m.id, controls(sim, 1, { mx: 1 }), 1050);
  sim.advance(1050);
  assert.equal(p.x, x);
  assert.equal(sim.tick, 3);
  sim.installPending();
  sim.advance(1067);
  assert.ok(p.x > x);
  assert.equal(sim.acks[m.id], 1);
  sim.advance(1117);
  assert.ok(sim.tick >= 7);
});
test("late parry whole-world replay restores HP, internal damage, streak, death and reflects exactly once", () => {
  const { sim, r, p, m } = setup();
  p.hp = 5;
  p.internal = 12;
  p.streak = 3;
  p.streakLeft = 2;
  r.game.bullets = [
    {
      id: 99,
      kind: "pistol",
      x: 217,
      y: 200,
      vx: -100,
      vy: 0,
      damage: 20,
      radius: 4,
      owner: "",
      life: 4,
    },
  ];
  sim.advance(1034);
  assert.equal(r.game.players[0].hp, 0);
  assert.equal(r.game.phase, "death");
  sim.receive(
    m.id,
    controls(sim, 1, { parry: 1, guard: true, angle: 0 }),
    1051,
  );
  sim.installPending(() => 0);
  sim.advance(1051);
  const q = r.game.players[0];
  assert.equal(q.hp, 5);
  assert.equal(q.internal, 4);
  assert.equal(q.streak, 4);
  assert.equal(q.perfects, 1);
  assert.equal(r.game.phase, "combat");
  assert.equal(r.game.bullets.filter((b) => b.owner === m.id).length, 1);
  assert.equal(sim.correction, 1);
  sim.receive(m.id, controls(sim, 1, { parry: 1, guard: true }), 1068);
  sim.installPending(() => 0);
  sim.advance(1068);
  assert.equal(r.game.players[0].perfects, 1);
});
test("replay respects cooldown, melee phases, enemy stun and non-parryable attacks", () => {
  for (const unparryable of [false, true]) {
    const { sim, r, m } = setup();
    r.game.bullets = [
      {
        id: 99,
        kind: "pistol",
        x: 217,
        y: 200,
        vx: -100,
        vy: 0,
        damage: 20,
        radius: 4,
        owner: "",
        unparryable,
        life: 4,
      },
    ];
    sim.advance(1017);
    sim.receive(
      m.id,
      controls(sim, 1, { parry: 1, guard: true, angle: 0 }),
      1034,
    );
    sim.installPending(() => 0);
    sim.advance(1034);
    assert.equal(r.game.players[0].perfects, unparryable ? 0 : 1);
    if (unparryable) assert.equal(r.game.players[0].hp, 96);
  }
});
test("duplicate actions are idempotent across transports; previous-run actions cannot mutate a new run", () => {
  const { sim, r, m } = setup();
  r.game.phase = "upgrade";
  r.game.players[0].offers = ["edge"];
  const action = {
    action: "upgrade",
    upgrade: "edge",
    runId: sim.runId,
    actionId: "upgrade-0001",
    actionSeq: 1,
  };
  sim.action(m.id, action, 1500);
  sim.action(m.id, clone(action), 1600);
  assert.deepEqual(r.game.players[0].upgrades, ["edge"]);
  assert.throws(
    () =>
      sim.action(
        m.id,
        { ...action, actionId: "upgrade-0002", runId: "stale" },
        1600,
      ),
    /Run changed/,
  );
});
test("disconnect neutralizes all stale controls without healing and grace expiry transfers membership", () => {
  const { sim, r, p, m } = setup();
  p.hp = 40;
  sim.receive(
    m.id,
    controls(sim, 1, { mx: 1, attack: true, guard: true, parry: 1, dash: 1 }),
    1001,
  );
  sim.installPending();
  sim.disconnect(m.id, 1002);
  assert.equal(r.inputs[m.id].mx, 0);
  assert.equal(r.inputs[m.id].guard, false);
  assert.equal(p.seenDash, 1);
  assert.equal(p.hp, 40);
  assert.equal(r.members.length, 1);
  sim.expire(1002 + NET.graceMs);
  assert.equal(r.members.length, 0);
});
test("reconstruction preserves the run and health but invalidates old transport history", () => {
  const { sim, r, p } = setup();
  p.hp = 33;
  sim.advance(1100);
  const saved = clone(sim.checkpoint()),
    restored = new RoomSimulation(saved.room, saved, 2000);
  assert.equal(restored.runId, sim.runId);
  assert.notEqual(restored.epoch, sim.epoch);
  assert.equal(restored.room.game.players[0].hp, 33);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.tick, sim.tick);
  assert.ok(r.game.time > 0);
});
test("streamed HTTP bodies enforce actual byte limits without trusting Content-Length", async () => {
  const request = new Request("http://test", {
    method: "POST",
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(NET.maxBody + 1));
        c.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(readBody(request), /too large/);
});
test("prediction uses shared dash/collision rules and cannot mutate HP, economy, enemies or emit events", () => {
  const { r, m } = setup(),
    before = clone(r.game),
    client = new MultiplayerClient(
      { id: m.id, code: "ABCDEF", token: "x" },
      { onError() {}, onSnapshot() {} },
    );
  client.game = clone(r.game);
  client.predicted = clone(client.game.players[0]);
  client.predicted.dashCd = 0;
  client.predictFrame(
    { mx: 1, dash: 1, attack: true, parry: 1, guard: true },
    1,
  );
  assert.ok(client.predicted.x > before.players[0].x);
  assert.ok(client.predicted.dashLeft > 0);
  assert.deepEqual(client.game, before);
  assert.equal(client.predicted.hp, before.players[0].hp);
});
test("historical defense preserves the original perfect/regular boundary and melee stun", () => {
  for (const [contactTick, expected] of [
    [6, "perfect"],
    [7, "regular"],
  ]) {
    const { sim, r, m } = setup();
    r.game.players[0].internal = 12;
    r.game.bullets = [
      {
        id: 99,
        kind: "pistol",
        x: 218.5 + ((contactTick - 1) * 100) / 60,
        y: 200,
        vx: -100,
        vy: 0,
        damage: 20,
        radius: 4,
        owner: "",
        life: 4,
      },
    ];
    for (let n = 0; n < contactTick; n++) sim.oneTick();
    assert.ok(
      sim.rewind(m.id, { input: { parry: 1, guard: true, angle: 0 } }, 0),
    );
    const p = r.game.players[0];
    assert.equal(p.perfects, expected === "perfect" ? 1 : 0);
    assert.equal(p.regulars, expected === "regular" ? 1 : 0);
    if (expected === "perfect") assert.equal(p.internal, 4);
    else assert.ok(p.internal > 12);
  }
  const { sim, r, m } = setup(),
    e = spawnEnemy(r.game, "brawler", 240, 200);
  Object.assign(e, {
    tell: 0.001,
    tellTotal: 0.3,
    action: "attack",
    angle: Math.PI,
    target: m.id,
    nearPlayer: true,
    cooldown: 100,
  });
  sim.oneTick();
  assert.ok(
    sim.rewind(m.id, { input: { parry: 1, guard: true, angle: 0 } }, 0),
  );
  assert.equal(r.game.players[0].perfects, 1);
  assert.ok(r.game.enemies.find((q) => q.id === e.id).stun > 0.9);
});
test("old actions cannot repeat after dedup retention expires; transport metadata does not change action identity", () => {
  const { sim, r, m } = setup();
  r.game.phase = "upgrade";
  r.game.players[0].offers = ["edge"];
  const action = {
    action: "upgrade",
    upgrade: "edge",
    runId: sim.runId,
    actionId: "stable-0001",
    actionSeq: 1,
  };
  sim.action(m.id, { ...action, type: "action", snapshotAck: 12 }, 1500);
  sim.action(
    m.id,
    { ...action, controller: "new-transport", snapshotAck: 99 },
    1600,
  );
  delete sim.actions[m.id + ":" + action.actionId];
  assert.throws(() => sim.action(m.id, action, 1700), /sequence expired/);
  assert.equal(
    r.game.players[0].upgrades.filter((x) => x === "edge").length,
    1,
  );
});
test("rejected input batches and actions are atomic and preserve eligible combat history", () => {
  const { sim, r, m } = setup();
  sim.oneTick();
  const history = sim.history.length;
  assert.throws(
    () =>
      sim.action(
        m.id,
        {
          action: "buy",
          runId: sim.runId,
          actionId: "invalid-buy-0001",
          actionSeq: 1,
        },
        1500,
      ),
    /Move close/,
  );
  assert.equal(sim.history.length, history);
  assert.equal(sim.actionSequences[m.id] || 0, 0);
  assert.throws(
    () =>
      sim.receive(
        m.id,
        {
          ...controls(sim, 1, { mx: 1 }),
          commands: [
            { seq: 1, input: { mx: 1 } },
            { seq: 2, input: { mx: NaN } },
          ],
        },
        1050,
      ),
    /Invalid mx/,
  );
  assert.equal(sim.received[m.id] || 0, 0);
  assert.equal(sim.pending.size, 0);
  assert.equal(r.inputs[m.id].mx, 0);
});
test("duplicate input packets cannot keep stale movement alive and burst coalescing preserves one defensive edge", () => {
  const { sim, r, m } = setup();
  const batch = Array.from({ length: 10 }, (_, i) => ({
    seq: i + 1,
    input: { mx: 1, parry: 1, guard: true },
  }));
  sim.receive(
    m.id,
    { runId: sim.runId, epoch: sim.epoch, commands: batch },
    1001,
  );
  sim.installPending();
  assert.equal(sim.queues.get(m.id).length, NET.queuedTicks);
  sim.advance(1020);
  assert.equal(r.game.players[0].seenParry, 1);
  sim.receive(
    m.id,
    { runId: sim.runId, epoch: sim.epoch, commands: batch },
    2200,
  );
  sim.expire(2600);
  assert.equal(r.inputs[m.id].mx, 0);
  assert.equal(r.inputs[m.id].guard, false);
  assert.equal(sim.acks[m.id], 10);
});
test("two players contesting one projectile cannot duplicate reflection, damage, streaks or committed effects", () => {
  const { sim, r, m } = setup(),
    other = member("Other", "sword", 1000),
    p = player(other.id, "Other", "sword");
  Object.assign(p, { x: 200, y: 200, invuln: 0 });
  r.members.push(other);
  r.game.players.push(p);
  sim.touch(other.id, 1000);
  sim.neutral(other.id);
  r.game.bullets = [
    {
      id: 99,
      kind: "pistol",
      x: 217,
      y: 200,
      vx: -100,
      vy: 0,
      damage: 20,
      radius: 4,
      owner: "",
      life: 4,
    },
  ];
  for (const id of [m.id, other.id])
    sim.receive(
      id,
      controls(sim, 1, { parry: 1, guard: true, angle: 0 }),
      1001,
    );
  sim.installPending();
  sim.oneTick();
  sim.oneTick();
  assert.ok(
    sim.rewind(other.id, { input: { parry: 2, guard: true, angle: 0 } }, 0),
  );
  assert.equal(
    r.game.players.reduce((sum, p) => sum + p.perfects, 0),
    1,
  );
  assert.equal(r.game.bullets.filter((b) => b.owner).length, 1);
  assert.ok(r.game.players.every((p) => p.hp === 100));
  sim.barrier();
  assert.equal(sim.events.filter((e) => e.kind === "perfect").length, 1);
});
test("late defensive correction does not wait behind movement commands or advance the simulation clock", () => {
  const { sim, r, m } = setup();
  r.game.players[0].hp = 5;
  r.game.bullets = [
    {
      id: 99,
      kind: "pistol",
      x: 217,
      y: 200,
      vx: -100,
      vy: 0,
      damage: 20,
      radius: 4,
      owner: "",
      life: 4,
    },
  ];
  sim.advance(1034);
  const tick = sim.tick;
  assert.equal(r.game.players[0].hp, 0);
  sim.receive(
    m.id,
    controls(sim, 1, { mx: 1, parry: 1, guard: true, angle: 0 }),
    1040,
  );
  assert.ok(sim.tryCompensate(m.id, () => 0, 1040));
  assert.equal(sim.tick, tick);
  assert.equal(r.game.players[0].x, 200);
  assert.equal(r.game.players[0].hp, 5);
  sim.installPending(() => 0);
  sim.advance(1051);
  assert.ok(r.game.players[0].x > 200);
  assert.equal(r.game.players[0].perfects, 1);
  assert.equal(sim.correction, 1);
});
