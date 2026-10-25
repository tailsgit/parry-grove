import { adminTeleport, spawnEnemy } from "../game/engine.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { driver, sleep } from "./helpers/room-driver.js";
import {
  beginRoute,
  openRouteDoors,
  selectRoute,
  claimKit,
} from "../game/run-content.js";
test("actual DO: four clients, auth exclusion/deadline, independent ticks, controller replacement and stale input", async () => {
  const d = await driver();
  try {
    const sessions = await d.party(4),
      h = sessions[0],
      a = await d.socket(h),
      b = await d.socket(sessions[1]),
      c = await d.socket(sessions[2]),
      e = await d.socket(sessions[3]),
      intruder = await d.socket(h, { auth: false });
    const before = a.latest.tick;
    for (let n = 0; n < 100 && a.latest.tick <= before + 4; n++)
      await sleep(10);
    assert.ok(a.latest.tick > before + 4);
    assert.equal(intruder.messages.length, 0);
    assert.equal(a.latest.game.players.length, 4);
    const replacement = await d.socket(h);
    await sleep(80);
    assert.ok(a.closed);
    assert.equal(
      replacement.latest.game.players.find((p) => p.id === h.id).disconnected,
      false,
    );
    replacement.send({
      type: "input",
      commands: [{ seq: 1, input: { mx: 1, guard: true, parry: 1, dash: 1 } }],
    });
    await sleep(100);
    await sleep(1550);
    const state = await d.fixture(h.code);
    assert.equal(state.room.inputs[h.id].mx, 0);
    assert.equal(state.room.inputs[h.id].guard, false);
    assert.ok(state.metrics.staleInputs > 0);
    assert.ok(!replacement.closed);
    await sleep(1400);
    assert.equal(
      (await d.fixture(h.code)).sockets.filter((s) => !s.id && !s.closed)
        .length,
      0,
    );
    assert.equal(intruder.messages.length, 0);
    assert.ok([b, c, e].every((c) => c.latest.tick > before));
  } finally {
    await d.close();
  }
});
test("actual DO: HTTP actions share authority, shop concurrency/idempotency, failed checkpoint recovery and reconstruction", async () => {
  const d = await driver();
  try {
    const [h, b] = await d.party(),
      fixture = await d.fixture(h.code),
      r = fixture.room,
      g = r.game,
      kits = [...g.kits];
    for (const [i, p] of g.players.entries()) {
      p.x = kits[i].x;
      p.y = kits[i].y;
      claimKit(g, p.id, kits[i].id);
    }
    beginRoute(g);
    g.routeOptions = ["shop"];
    openRouteDoors(g);
    const door = g.routeDoors[0],
      leader = g.players[0];
    leader.x = door.x;
    leader.y = door.y;
    selectRoute(g, h.id, "shop");
    g.time = Math.max(...g.stock.map((i) => i.readyAt)) + 0.1;
    g.scrap = 90;
    const item = g.stock.find((i) => i.cost === 90);
    for (const p of g.players) {
      p.x = item.x;
      p.y = item.y;
    }
    await d.fixture(h.code, "seed", r);
    const resumed = await d.http({ action: "resume" }, h),
      epoch = resumed.data.epoch,
      runId = resumed.data.runId;
    const invalid = await d.http({ action: "buy", item: item.id }, h);
    assert.equal(invalid.status, 400);
    assert.equal((await d.http({ action: "poll" }, h)).data.game.scrap, 90);
    const inputs = [h, b].map((s) =>
      d.http(
        {
          action: "input",
          runId,
          epoch,
          commands: [{ seq: 1, input: { interact: 1 } }],
        },
        s,
      ),
    );
    await Promise.all(inputs);
    await sleep(100);
    const bought = (await d.http({ action: "poll" }, h)).data;
    assert.equal(bought.game.scrap, 0);
    assert.equal(bought.game.stock.find((i) => i.id === item.id).left, 0);
    assert.equal(
      bought.game.players.filter((p) => p.upgrades.includes(item.id)).length,
      1,
    );
    await d.http(
      {
        action: "input",
        runId,
        epoch,
        commands: [{ seq: 1, input: { interact: 1 } }],
      },
      h,
    );
    await sleep(50);
    assert.equal((await d.http({ action: "poll" }, h)).data.game.scrap, 0);
    const f = await d.fixture(h.code);
    f.room.game.phase = "upgrade";
    f.room.game.players[0].offers = ["edge"];
    f.room.game.players[0].chosen = false;
    await d.fixture(h.code, "seed", f.room);
    const fresh = await d.http({ action: "resume" }, h);
    await d.fixture(h.code, "fail");
    const action = {
      action: "upgrade",
      upgrade: "edge",
      actionId: "upgrade-retry-0001",
      runId: fresh.data.runId,
    };
    const failed = await d.http(action, h);
    assert.equal(failed.status, 400);
    const retried = await d.http(action, h);
    assert.equal(retried.status, 200);
    assert.equal(
      retried.data.game.players[0].upgrades.filter((x) => x === "edge").length,
      f.room.game.players[0].upgrades.filter((x) => x === "edge").length + 1,
    );
    const oldEpoch = retried.data.epoch,
      hp = retried.data.game.players[0].hp;
    try {
      await d.fixture(h.code, "reset");
    } catch {}
    const recovered = await d.http({ action: "resume" }, h);
    assert.equal(recovered.status, 200);
    assert.notEqual(recovered.data.epoch, oldEpoch);
    assert.equal(recovered.data.game.players[0].hp, hp);
    assert.equal(
      recovered.data.game.players[0].upgrades.filter((x) => x === "edge")
        .length,
      retried.data.game.players[0].upgrades.filter((x) => x === "edge").length,
    );
  } finally {
    await d.close();
  }
});
test("actual DO: version/finite input/payload boundaries, superseded run denial and bounded slow receivers", async () => {
  const d = await driver();
  try {
    const [h] = await d.party(1);
    const bad = await d.http({ action: "poll", version: 99 }, h);
    assert.equal(bad.status, 426);
    const a = await d.socket(h);
    a.send({ type: "input", commands: [{ seq: 1, input: { mx: 2 } }] });
    await sleep(40);
    assert.ok(
      a.messages.some(
        (m) => m.type === "error" && /Invalid mx/.test(m.message),
      ),
    );
    a.send({
      type: "action",
      action: "retry",
      actionId: "stale-retry-0001",
      runId: "old-run",
    });
    await sleep(40);
    assert.ok(a.messages.some((m) => m.status === 409));
    const stalled = await d.socket(h, { ack: false });
    await sleep(5500);
    assert.ok(!(await d.fixture(h.code)).controllers.includes(h.id));
    assert.ok(
      stalled.messages.filter((m) => m.type === "snapshot").length <= 4,
    );
    const fresh = await d.socket(h);
    fresh.ws.send("x".repeat(5000));
    await sleep(100);
    assert.ok(fresh.closed);
  } finally {
    await d.close();
  }
});
test("actual DO: a server-receipt validated late parry reverses provisional death and forged view ticks cannot rewind", async () => {
  const d = await driver();
  try {
    const [h] = await d.party(1),
      a = await d.socket(h),
      f = await d.fixture(h.code),
      g = f.room.game,
      p = g.players[0];
    adminTeleport(g, 1, 1);
    g.phase = "combat";
    g.enemies = [];
    spawnEnemy(g, "bow", 800, 450).cooldown = 100;
    g.obstacles = [];
    g.intro = 0;
    Object.assign(p, {
      x: 200,
      y: 200,
      hp: 5,
      internal: 12,
      invuln: 0,
      streak: 3,
      streakLeft: 2,
    });
    g.bullets = [
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
    const seed = await d.fixture(h.code, "seed", f.room);
    for (
      let n = 0;
      n < 40 &&
      (a.latest.epoch !== seed.epoch || a.latest.game.players[0].hp > 0);
      n++
    )
      await sleep(5);
    assert.equal(a.latest.game.players[0].hp, 0);
    a.send({
      type: "input",
      commands: [
        {
          seq: 1,
          input: { parry: 1, guard: true, angle: 0 },
          viewTick: 0,
          viewSequence: a.latest.sequence,
        },
      ],
    });
    for (let n = 0; n < 30 && a.latest.correction < 1; n++) await sleep(10);
    assert.equal(a.latest.correction, 1);
    assert.equal(a.latest.game.players[0].hp, 5);
    assert.equal(a.latest.game.players[0].internal, 4);
    assert.equal(a.latest.game.players[0].streak, 4);
    assert.equal(
      a.latest.game.bullets.filter((b) => b.owner === h.id).length,
      1,
    );
    a.send({
      type: "input",
      commands: [
        {
          seq: 2,
          input: { parry: 2, guard: true, angle: 0 },
          viewTick: 100000,
          viewSequence: a.latest.sequence,
        },
      ],
    });
    await sleep(100);
    assert.equal(a.latest.correction, 1);
    assert.ok((await d.fixture(h.code)).metrics.rejectedRewinds > 0);
  } finally {
    await d.close();
  }
});
test("actual native admission bindings, HTTP size enforcement and bounded event replay cursors", async () => {
  const limited = await driver({ admissionLimit: 2 });
  try {
    assert.equal((await limited.http({ action: "create" })).status, 200);
    assert.equal((await limited.http({ action: "create" })).status, 200);
    assert.equal((await limited.http({ action: "create" })).status, 429);
  } finally {
    await limited.close();
  }
  const d = await driver();
  try {
    const [h] = await d.party(1);
    const huge = await d.http(
      { action: "poll", padding: "x".repeat(12000) },
      h,
    );
    assert.equal(huge.status, 413);
    const f = await d.fixture(h.code);
    f.room.game.events = Array.from({ length: 300 }, (_, i) => ({
      id: i + 1,
      kind: "hit",
      x: 10,
      y: 10,
      time: f.room.game.time,
    }));
    await d.fixture(h.code, "seed", f.room);
    const a = await d.socket(h);
    for (
      let n = 0;
      n < 100 &&
      new Set(a.messages.flatMap((m) => m.game?.events?.map((e) => e.id) || []))
        .size < 256;
      n++
    )
      await sleep(10);
    const snapshots = a.messages.filter((m) => m.type === "snapshot"),
      ids = new Set(
        snapshots.flatMap((m) =>
          m.game.events
            .filter((e) => e.kind === "hit" && e.x === 10 && e.y === 10)
            .map((e) => e.id),
        ),
      );
    assert.equal(ids.size, 256);
    assert.ok(snapshots.every((m) => m.game.events.length <= 64));
    assert.ok(snapshots.some((m) => m.eventGap));
    assert.ok(snapshots.at(-1).eventFloor >= 45);
    const pending = [];
    for (let i = 0; i < 7; i++)
      pending.push(await d.socket(h, { auth: false }));
    assert.equal((await d.socket(h, { auth: false })).status, 429);
  } finally {
    await d.close();
  }
});
