import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
const files = (await readdir("dist/server", { recursive: true })).filter(
  (p) => /\.m?js$/.test(p) && p !== "index.js",
);
const modules = ["index.js", ...files].map((p) => ({
  type: "ESModule",
  path: "dist/server/" + p,
}));
const mf = new Miniflare({
  cf: false,
  modules,
  modulesRoot: "dist/server",
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  durableObjects: { ROOMS: "RoomRealtime" },
});
try {
  const db = await mf.getD1Database("DB");
  await db.exec(
    (await readFile("drizzle/0000_happy_kang.sql", "utf8")).replaceAll(
      "\n",
      " ",
    ),
  );
  const response = await mf.dispatchFetch("http://game.test/");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of [
    "PARRY GROVE",
    "Play solo",
    "Create co-op room",
    "Story",
    "Endless",
    "canvas",
  ])
    assert.ok(
      html.toLowerCase().includes(text.toLowerCase()),
      "Missing " + text,
    );
  const post = async (body) => {
    const r = await mf.dispatchFetch("http://game.test/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, ...body }),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  const created = await post({
      action: "create",
      name: "Build smoke",
      weapon: "dagger",
    }),
    session = { ...created.session, code: created.code };
  assert.equal(created.members[0].weapon, "dagger");
  assert.equal(created.version, 2);
  await post({
    ...session,
    action: "ready",
    runId: created.runId,
    actionId: "build-ready-0001",
    actionSeq: 1,
  });
  const started = await post({
    ...session,
    action: "start",
    runId: created.runId,
    actionId: "build-start-0001",
    actionSeq: 2,
  });
  assert.equal(started.game.phase, "draft");
  await new Promise((r) => setTimeout(r, 100));
  const running = await post({ ...session, action: "poll" });
  assert.ok(running.tick > started.tick);
  assert.ok(running.game.time > started.game.time);
  const socket = await mf.dispatchFetch(
    "http://game.test/api/room/socket?code=" + created.code,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(socket.status, 101);
  socket.webSocket.accept();
  socket.webSocket.close();
  console.log(
    "Production Worker verified: menu, protocol v2, durable room creation/start, independent simulation and WebSocket upgrade.",
  );
} finally {
  await mf.dispose();
}
