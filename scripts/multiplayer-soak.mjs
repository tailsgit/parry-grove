// Four-player accelerated simulation/replay soak, with test-only boosted HP and
// damage. It measures engine/network-state cost, not normal difficulty or WAN.
import { RoomSimulation } from "../game/room-simulation.js";
import { createRun } from "../game/run-content.js";
import { player, adminTeleport } from "../game/engine.js";
import { member, roomState } from "../game/rooms.js";
import { compactGame } from "../game/room-snapshot.js";
import { writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
const members = Array.from({ length: 4 }, (_, i) =>
    member("P" + i, "sword", 1000),
  ),
  room = roomState(members[0], 1000, "endless");
room.members = members;
room.game = createRun(
  members.map((m) => player(m.id, m.name, m.weapon, m.slot)),
  42,
  "endless",
);
const sim = new RoomSimulation(room, {}, 1000);
for (const m of members) sim.touch(m.id, 1000);
const rows = [],
  durations = [],
  replayCosts = [];
let maxEnemies = 0,
  maxBullets = 0,
  maxHazards = 0,
  maxHistoryBytes = 0,
  maxEvents = 0,
  totalTicks = 0,
  wall = 1000;
for (let n = 1; n <= 30; n++) {
  sim.barrier();
  adminTeleport(room.game, 1, n);
  for (const [i, p] of room.game.players.entries()) {
    p.hp = p.maxHp = 100000;
    p.damage = 6;
    p.kitId = "test";
    p.x = 150 + i * 20;
    p.y = 200 + i * 35;
    p.invuln = 0;
  }
  room.game.intro = 0;
  let ticks = 0;
  for (; ticks < 3600 && room.game.phase === "combat"; ticks++) {
    const g = room.game;
    for (const p of g.players) {
      const enemy = g.enemies.find((e) => e.hp > 0 && !e.wormInvulnerable);
      const dx = (enemy?.x ?? g.width / 2) - p.x,
        dy = (enemy?.y ?? g.height / 2) - p.y,
        angle = Math.atan2(dy, dx),
        distance = Math.hypot(dx, dy);
      room.inputs[p.id] = {
        mx: distance > 45 ? Math.cos(angle) : 0,
        my: distance > 45 ? Math.sin(angle) : 0,
        angle,
        attack: true,
        guard: true,
        parry: Math.floor(ticks / 18),
        dash: Math.floor(ticks / 90),
        interact: 0,
      };
    }
    wall += 1000 / 60;
    sim.lastWall = wall;
    for (const m of members) {
      m.lastSeen = wall;
      sim.inputAt[m.id] = wall;
    }
    const t = performance.now();
    sim.oneTick();
    durations.push(performance.now() - t);
    totalTicks++;
    if (ticks % 120 === 100 && sim.history.length === 12) {
      const oldest = sim.history[2],
        id = members[0].id;
      const start = performance.now();
      sim.rewind(
        id,
        {
          input: {
            parry: (oldest.inputs[id]?.parry || 0) + 1,
            guard: true,
            angle: oldest.inputs[id]?.angle || 0,
          },
        },
        oldest.tick - 1,
      );
      replayCosts.push(performance.now() - start);
    }
    maxEnemies = Math.max(maxEnemies, room.game.enemies.length);
    maxBullets = Math.max(maxBullets, room.game.bullets.length);
    maxHazards = Math.max(maxHazards, room.game.hazards.length);
    maxEvents = Math.max(maxEvents, sim.events.length);
    assert.ok(sim.history.length <= 12);
    assert.ok(sim.events.length <= 256);
    for (const p of room.game.players)
      assert.ok(Number.isFinite(p.hp) && Number.isFinite(p.x));
    if (ticks % 300 === 0)
      maxHistoryBytes = Math.max(
        maxHistoryBytes,
        Buffer.byteLength(JSON.stringify(sim.history)),
      );
  }
  global.gc?.();
  rows.push({
    room: n,
    ticks,
    cleared: room.game.phase !== "combat",
    heapMB: process.memoryUsage().heapUsed / 1048576,
    snapshotBytes: Buffer.byteLength(JSON.stringify(compactGame(room.game))),
  });
  if (n % 5 === 0) console.log("soak", n, totalTicks);
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
const result = {
  mode: "accelerated 30-room four-player simulation with boosted HP/damage",
  rooms: rows,
  totalTicks,
  maxEnemies,
  maxBullets,
  maxHazards,
  maxHistoryBytes,
  maxEvents,
  tickMs: {
    median: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: Math.max(...durations),
  },
  replayMs: {
    samples: replayCosts.length,
    median: percentile(replayCosts, 0.5),
    p95: percentile(replayCosts, 0.95),
    max: Math.max(...replayCosts),
  },
  metrics: sim.metrics,
};
await mkdir("docs/multiplayer", { recursive: true });
await writeFile("docs/multiplayer/soak.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, rooms: rows.length }));
