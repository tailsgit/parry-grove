import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
const {createGame,player,step}=await import(pathToFileURL(resolve("game/engine.js")).href);
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
const bundle = await build({
    stdin: {
      contents:
        "import{POST}from'./app/api/room/route.ts';import{GET}from'./app/api/room/socket/route.ts';export{RoomRealtime}from'./game/room-realtime.ts';export default{fetch:r=>r.headers.get('Upgrade')?GET(r):POST(r)};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
    tsconfig: "tsconfig.json",
  }),
  mf = new Miniflare({
    cf: false,
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    durableObjects: { ROOMS: "RoomRealtime" },
  }),
  sockets = [];
try {
  const db = await mf.getD1Database("DB");
  await db.exec(
    (await readFile("drizzle/0000_happy_kang.sql", "utf8")).replaceAll(
      "\n",
      " ",
    ),
  );
  const post = async (body, s = {}) => {
    const r = await mf.dispatchFetch("http://test/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...s }),
    });
    return { status: r.status, data: await r.json() };
  };
  const c = await post({ action: "create" }),
    host = { code: c.data.code, ...c.data.session },
    sessions = [host];
  for (let i = 1; i < 4; i++) {
    const j = await post({ action: "join", code: host.code });
    sessions.push({ code: host.code, ...j.data.session });
  }
  for (const s of sessions) await post({ action: "ready" }, s);
  await post({ action: "start" }, host);
  let count = 0,
    bytes = 0,
    latest,
    errors = 0,
    unauthorized = 0;
  const start = performance.now();
  for (const s of [...sessions, null]) {
    const res = await mf.dispatchFetch(
        "http://test/api/room/socket?code=" + host.code,
        { headers: { Upgrade: "websocket" } },
      ),
      socket = res.webSocket;
    socket.accept();
    sockets.push(socket);
    socket.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "snapshot") {
        if (!s) unauthorized++;
        else if (s === host) {
          count++;
          bytes += Buffer.byteLength(e.data);
          latest = m;
        }
      }
      if (m.type === "error") errors++;
    });
    if (s)
      socket.send(JSON.stringify({ type: "auth", id: s.id, token: s.token }));
  }
  const timer = setInterval(() => {
    for (const s of sockets.slice(0, 4))
      s.send(
        JSON.stringify({ type: "input", input: { mx: 1, my: 0, angle: 0 } }),
      );
  }, 33);
  await new Promise((r) => setTimeout(r, 2200));
  clearInterval(timer);
  const elapsed = (performance.now() - start) / 1000;
  const game = createGame(
    [0, 1, 2, 3].map((i) => player("p" + i, "Test")),
    42,
  );
  game.players.forEach((p) => (p.hp = p.maxHp = 1e6));
  const costs = [];
  for (let i = 0; i < 600; i++) {
    const t = performance.now();
    step(game, {}, 1 / 60);
    costs.push(performance.now() - t);
  }
  costs.sort((a, b) => a - b);
  const result = {
    source: execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
    clients: 4,
    elapsedSeconds: elapsed,
    inputHzPerClient: 1000 / 33,
    snapshotsToHost: count,
    snapshotHz: count / elapsed,
    averageSnapshotBytes: bytes / count,
    hostBytesPerSecond: bytes / elapsed,
    unauthenticatedSnapshots: unauthorized,
    errors,
    simulationMs: { median: costs[300], p95: costs[570] },
    simulationTime: latest?.game.time,
    correctionTelemetry: "absent",
    browserInputToPaint: "not measured by this server harness",
    shopFailureCause: "test omits required E/interact edge",
  };
  await mkdir("docs/multiplayer", { recursive: true });
  await writeFile(
    "docs/multiplayer/baseline.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  for (const s of sockets)
    try {
      s.close();
    } catch {}
  await mf.dispose();
}
