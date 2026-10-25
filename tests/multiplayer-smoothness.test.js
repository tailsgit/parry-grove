import { test } from "node:test";
import assert from "node:assert/strict";
import { MultiplayerClient } from "../game/multiplayer-client.js";
import { SnapshotEncoder, decodeSnapshot } from "../game/snapshot-wire.js";
import { HistoryPool } from "../game/state-copy.js";
import { compactGame } from "../game/room-snapshot.js";
import { RoomSimulation } from "../game/room-simulation.js";
import { member, roomState } from "../game/rooms.js";
import { createRun } from "../game/run-content.js";
import { player, spawnEnemy } from "../game/engine.js";
const hooks = { onError() {}, onSnapshot() {} };
function client() {
  return new MultiplayerClient({ id: "p", code: "ABCDEF", token: "t" }, hooks);
}
test("correction decay matches at 30/60/120/144 FPS and local render interpolates fixed positions", () => {
  const results = [];
  for (const fps of [30, 60, 120, 144]) {
    const c = client();
    c.game = { phase: "combat" };
    c.correctionOffset = { x: 10, y: 5 };
    for (let i = 0; i < fps; i++) c.frame(1 / fps, {});
    results.push(c.correctionOffset.x);
  }
  for (const n of results) assert.ok(Math.abs(n - results[0]) < 1e-12);
  const c = client();
  c.game = {
    players: [{ id: "p", x: 10, y: 0 }],
    enemies: [],
    bullets: [],
    hazards: [],
  };
  c.predicted = { id: "p", x: 10, y: 0 };
  c.renderPrevious = { x: 0, y: 0 };
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    c.frameAccumulator = alpha / 60;
    assert.ok(
      Math.abs(c.display(performance.now(), {}).players[0].x - 10 * alpha) <
        1e-10,
    );
  }
  assert.equal(c.predicted.x, 10);
});
test("edge inputs flush inside frame sampling without waiting for the batch timer", () => {
  const c = client(),
    sent = [];
  c.game = { phase: "combat" };
  c.send = (m) => {
    sent.push(m);
    return true;
  };
  c.frame(1 / 60, { parry: 1, dash: 1, attackPress: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].commands[0].input.parry, 1);
  assert.equal(sent[0].commands[0].input.attackPress, 1);
  assert.ok(sent[0].commands[0].sentAt >= sent[0].commands[0].createdAt);
});
test("pooled history owns nested data, clears events and reuses bounded snapshot containers", () => {
  const pool = new HistoryPool(),
    g = {
      players: [{ hp: 10, upgrades: ["a"] }],
      events: [{ id: 1 }],
      optional: 2,
    };
  const first = pool.capture(g);
  g.players[0].hp = 5;
  g.players[0].upgrades.push("b");
  assert.equal(first.players[0].hp, 10);
  assert.deepEqual(first.events, []);
  pool.release(first);
  delete g.optional;
  const next = pool.capture(g);
  assert.equal(first, next);
  assert.equal(next.optional, undefined);
  assert.equal(next.players[0].hp, 5);
  assert.equal(pool.created, 1);
  assert.equal(pool.reused, 1);
});
test("binary snapshot is self-contained, shrinks keys, bounds quantization, and rejects malformed input", () => {
  const g = createRun(
    Array.from({ length: 4 }, (_, i) => player("p" + i, "P" + i, "sword", i)),
    42,
  );
  g.players[0].x = 123.456;
  g.players[0].vx = 321.456;
  const message = {
      type: "snapshot",
      version: 2,
      sequence: 3,
      game: compactGame(g),
    },
    encoder = new SnapshotEncoder();
  const buffer = encoder.encode(message),
    decoded = decodeSnapshot(buffer);
  assert.equal(decoded.game.players.length, 4);
  assert.equal(decoded.sequence, 3);
  assert.ok(Math.abs(decoded.game.players[0].x - 123.456) <= 1 / 32);
  assert.ok(Math.abs(decoded.game.players[0].vx - 321.456) <= 1 / 8);
  assert.equal(decoded.game.players[0].hp, g.players[0].hp);
  assert.ok(buffer.byteLength < Buffer.byteLength(JSON.stringify(message)));
  assert.throws(() => decodeSnapshot(buffer.slice(0, -1)), /Truncated/);
  assert.throws(() => decodeSnapshot(new Uint8Array([1, 2, 3])), /Unsupported/);
  const large = {
    x: 50000,
    y: -50000,
    vx: 100000,
    unknown: { nested: "safe" },
  };
  assert.deepEqual(decodeSnapshot(encoder.encode(large)), large);
  assert.throws(
    () =>
      decodeSnapshot(
        encoder.encode(JSON.parse('{"__proto__":{"polluted":true}}')),
      ),
    /Invalid snapshot field/,
  );
  assert.equal({}.polluted, undefined);
});
test("authoritative effects publish in their own tick and unchanged replay never duplicates delivery", () => {
  const m = member("P", "sword", 1000),
    r = roomState(m, 1000);
  r.game = createRun([player(m.id, m.name, "sword")], 42);
  const g = r.game;
  g.phase = "combat";
  g.enemies = [];
  g.obstacles = [];
  g.intro = 0;
  const p = g.players[0];
  p.x = p.y = 200;
  p.angle = 0;
  p.attackCd = 0;
  spawnEnemy(g, "bow", 230, 200).hp = 1000;
  const s = new RoomSimulation(r, {}, 1000);
  s.touch(m.id, 1000);
  s.receive(
    m.id,
    {
      runId: s.runId,
      epoch: s.epoch,
      commands: [{ seq: 1, input: { attack: true, attackPress: 1 } }],
    },
    1001,
  );
  s.installPending();
  s.advance(1017);
  assert.ok(s.events.some((e) => e.kind === "hit"));
  assert.ok(s.history.length < 12);
  const before = s.events.map((e) => e.id);
  s.barrier();
  assert.deepEqual(
    s.events.map((e) => e.id),
    before,
  );
});

test("DOM edge flush predicts startup without advancing movement or waiting for a physics step", () => {
  const c = client(),
    sent = [];
  c.game = createRun([player("p", "P", "sword")], 42);
  c.game.phase = "combat";
  c.game.obstacles = [];
  c.predicted = { ...c.game.players[0] };
  const x = c.predicted.x;
  c.send = (m) => {
    sent.push(m);
    return true;
  };
  c.flushEdges({ mx: 1, dash: 1, parry: 0, attackPress: 0, angle: 0 });
  assert.equal(c.predicted.x, x);
  assert.ok(c.predicted.dashLeft > 0);
  assert.equal(c.frames[0].edgeOnly, true);
  assert.equal(sent.length, 1);
  c.flushEdges({ mx: 1, dash: 1, parry: 0, attackPress: 0, angle: 0 });
  assert.equal(sent.length, 1);
});

test("binary transport negotiates its codec and an unknown codec falls back to JSON", async () => {
  const { driver } = await import("./helpers/room-driver.js");
  const d = await driver();
  try {
    const sessions = await d.party(2);
    const a = await d.socket(sessions[0], { binary: true });
    assert.ok(a.binarySnapshots > 0);
    const b = await d.socket(sessions[1], { binary: true, binaryVersion: 999 });
    assert.equal(b.binarySnapshots, 0);
    assert.equal(b.latest.game.players.length, 2);
  } finally {
    await d.close();
  }
});
test("pooled display entities never mutate authoritative snapshots or extrapolate projectiles", () => {
  const c = client();
  c.interpolationMs = 0;
  c.offset = 0;
  c.rtt = 0;
  const older = {
    players: [],
    enemies: [{ id: 1, x: 0, y: 0 }],
    bullets: [{ id: 2, x: 20, y: 0 }],
    hazards: [],
  };
  const newer = {
    players: [],
    enemies: [{ id: 1, x: 10, y: 0 }],
    bullets: [{ id: 2, x: 40, y: 0 }],
    hazards: [],
  };
  c.game = newer;
  c.history = [older, newer].map((game, i) => ({
    game,
    serverTime: i * 1000,
    tick: i,
    lookups: Object.fromEntries(
      ["players", "enemies", "bullets", "hazards"].map((k) => [
        k,
        new Map(game[k].map((e) => [e.id, e])),
      ]),
    ),
  }));
  const shown = c.display(500, {});
  assert.equal(shown.enemies[0].x, 5);
  assert.equal(shown.bullets[0].x, 30);
  assert.equal(newer.enemies[0].x, 10);
  assert.equal(newer.bullets[0].x, 40);
  const entity = shown.enemies[0];
  assert.equal(c.display(750, {}).enemies[0], entity);
  assert.equal(c.display(1200, {}).bullets[0].x, 40);
});
