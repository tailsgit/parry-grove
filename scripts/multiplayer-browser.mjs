import {
  NetworkTestMiniflare,
  networkFixturePlugin,
} from "../tests/helpers/multiplayer.js";
import { decodeSnapshot } from "../game/snapshot-wire.js";
import { createRun } from "../game/run-content.js";
import { adminTeleport, spawnEnemy } from "../game/engine.js";
// Real Chromium + real Durable Objects. Profiles emulate ordered WebSocket message
// delay/retransmission stalls, not kernel-level TCP packet loss or a WAN.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
const source = resolve(process.env.MP_SOURCE || "."),
  output = resolve(process.env.MP_OUTPUT || "docs/multiplayer/browser"),
  before = !!process.env.MP_SOURCE;
const template = await readFile(
    join(source, "tests/playtest-preview.html"),
    "utf8",
  ),
  code = template.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const ui = await build({
  stdin: { contents: code, resolveDir: join(source, "tests"), loader: "jsx" },
  bundle: true,
  write: false,
  format: "esm",
  plugins: [
    {
      name: "browser-observation",
      setup(b) {
        b.onLoad({ filter: /game\/renderer\.js$/ }, async (a) => ({
          loader: "js",
          contents: (await readFile(a.path, "utf8")).replace(
            "  draw(g,me,dt,attract=false) {",
            `  draw(g,me,dt,attract=false) {if(window.qaInput){const p=g.players.find(p=>p.id===me);if(p&&((window.qaInput.kind==='dash'&&p.dashLeft>0)||(window.qaInput.kind==='guard'&&p.parryLeft>0)||(window.qaInput.kind==='swing'&&p.swing>0))){window.qaVisibleMs=performance.now()-window.qaInput.at;window.qaInput=null;}}`,
          ),
        }));
        b.onLoad({ filter: /game\/multiplayer-client\.js$/ }, async (a) => ({
          loader: "js",
          contents: (await readFile(a.path, "utf8")).replace(
            /constructor\(session,\s*hooks\)\s*\{/g,
            "$&window.qaNet=this;",
          ),
        }));
      },
    },
  ],
});
const html = template.replace(
  /<script type="module">[\s\S]*<\/script>/,
  '<script type="module" src="/qa.js"></script>',
);
const worker = await build({
  stdin: {
    contents: `import{env}from'cloudflare:workers';import{POST}from'./app/api/room/route.ts';import{GET}from'./app/api/room/socket/route.ts';export{RoomRealtime}from'./game/room-realtime.ts';export default{fetch:r=>{const p=new URL(r.url).pathname;return p==='/api/room/socket'?GET(r):p==='/api/room'?POST(r):new Response(p==='/qa.js'?env.QA_JS:p.endsWith('.css')?env.QA_CSS:env.QA_HTML,{headers:{'Content-Type':p==='/qa.js'?'text/javascript':p.endsWith('.css')?'text/css':'text/html'}})}};`,
    resolveDir: source,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  plugins: before ? [] : [networkFixturePlugin],
  external: ["cloudflare:workers"],
  tsconfig: join(source, "tsconfig.json"),
});
const FixtureRuntime = before ? Miniflare : NetworkTestMiniflare;
const mf = new FixtureRuntime({
  cf: false,
  modules: true,
  script: worker.outputFiles[0].text,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  durableObjects: { ROOMS: "RoomRealtime" },
  bindings: {
    QA_JS: ui.outputFiles[0].text,
    QA_HTML: html,
    QA_CSS: await readFile("app/globals.css", "utf8"),
  },
});
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
let browser;
try {
  const db = await mf.getD1Database("DB");
  await db.exec(
    (await readFile("drizzle/0000_happy_kang.sql", "utf8")).replaceAll(
      "\n",
      " ",
    ),
  );
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  });
  const pages = [],
    contexts = [],
    errors = [],
    profile = { rtt: 0, jitter: 0, loss: 0 },
    wire = { messages: 0, stalls: 0, bytes: 0, snapshots: 0 },
    clients = [];
  for (let i = 0; i < 4; i++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    contexts.push(context);
    if (process.env.MP_MIXED_FPS) {
      const fps = [30, 60, 120, 144][i];
      await context.addInitScript((fps) => {
        window.qaFrameTimes = [];
        window.requestAnimationFrame = (callback) =>
          setTimeout(() => {
            window.qaFrameTimes.push(performance.now());
            if (window.qaFrameTimes.length > 200) window.qaFrameTimes.shift();
            callback(performance.now());
          }, 1000 / fps);
        window.cancelAnimationFrame = clearTimeout;
      }, fps);
    }
    await context.routeWebSocket("**/api/room/socket*", (ws) => {
      const server = ws.connectToServer();
      const link = { up: 0, down: 0, countUp: 0, countDown: 0 };
      const forward = (direction, message, send) => {
        wire.messages++;
        wire.bytes +=
          typeof message === "string"
            ? Buffer.byteLength(message)
            : message.length;
        const count = ++link[direction === "up" ? "countUp" : "countDown"];
        let delay =
          profile.rtt / 2 +
          (profile.jitter ? ((count % 3) - 1) * profile.jitter : 0);
        if (profile.loss && count % Math.round(100 / profile.loss) === 0) {
          delay += 200;
          wire.stalls++;
        }
        const due = Math.max(Date.now() + Math.max(0, delay), link[direction]);
        if (direction === "down") {
          wire.maxOrderedQueueMs = Math.max(
            wire.maxOrderedQueueMs || 0,
            due - Date.now(),
          );
          if (due > Date.now() + Math.max(0, delay) + 1)
            wire.messagesBehindStall = (wire.messagesBehindStall || 0) + 1;
        }
        link[direction] = due;
        setTimeout(
          () => {
            try {
              send(message);
            } catch {}
          },
          Math.max(0, due - Date.now()),
        );
      };
      ws.onMessage((m) => forward("up", m, (x) => server.send(x)));
      server.onMessage((m) => {
        try {
          const d = typeof m === "string" ? JSON.parse(m) : decodeSnapshot(m);
          if (d.type === "snapshot") wire.snapshots++;
        } catch {}
        forward("down", m, (x) => ws.send(x));
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.goto((await mf.ready).toString());
    pages.push(page);
  }
  const [a, b] = pages;
  let cdp,
    traceEvents = [];
  if (process.env.MP_PROFILE) {
    cdp = await contexts[0].newCDPSession(a);
    cdp.on("Tracing.dataCollected", (e) => traceEvents.push(...e.value));
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline,v8,disabled-by-default-v8.gc",
      options: "record-as-much-as-possible",
    });
  }
  await a.getByRole("button", { name: /^Create co-op room/ }).click();
  await a.locator(before ? ".room-code" : ".party-code").waitFor();
  const room = before
    ? (await a.locator(".room-code").innerText()).slice(0, 6)
    : await a.locator(".party-code").inputValue();
  for (const p of pages.slice(1)) {
    await p
      .getByRole("textbox", { name: "Six-character room code" })
      .fill(room);
    await p.getByRole("button", { name: "JOIN ↗" }).click();
    await p.locator(before ? ".room-code" : ".party-code").waitFor();
  }
  for (const p of before ? pages : pages.slice(1))
    await p.getByRole("button", { name: /^Ready up/ }).click();
  await a
    .getByRole("button", { name: before ? "Start the run ↗" : /^Start run/ })
    .click();
  for (const p of pages) await p.locator(".game-hud").waitFor();
  await mkdir(output, { recursive: true });
  await a.screenshot({ path: join(output, "four-player-draft.png") });
  const profiles = [];
  for (const settings of [
    { rtt: 0, jitter: 0, loss: 0 },
    { rtt: 50, jitter: 10, loss: 0 },
    { rtt: 100, jitter: 10, loss: 0 },
    { rtt: 150, jitter: 10, loss: 0 },
    { rtt: 100, jitter: 10, loss: 1 },
    { rtt: 100, jitter: 10, loss: 2 },
  ]) {
    Object.assign(profile, settings);
    await a.waitForTimeout(1000);
    const samples = [];
    for (const [kind, key] of [
      ["dash", " "],
      ["guard", "q"],
      ["swing", "lmb"],
    ]) {
      await a.locator("canvas").focus();
      await a.evaluate((kind) => {
        window.qaVisibleMs = null;
        window.qaInput = { kind, at: performance.now() };
      }, kind);
      if (key === "lmb") await a.mouse.click(650, 380);
      else await a.keyboard.press(key);
      try {
        await a.waitForFunction(
          () => window.qaVisibleMs !== null,
          {},
          { timeout: 1500 },
        );
        samples.push({
          kind,
          inputToRenderMs: await a.evaluate(() => window.qaVisibleMs),
        });
      } catch {
        samples.push({ kind, timeout: true });
      }
      await a.waitForTimeout(900);
    }
    const metric = await a.evaluate(() =>
      window.qaNet
        ? {
            ...window.qaNet.metrics,
            interpolationMs: window.qaNet.interpolationMs,
            frames: window.qaNet.frames.length,
            serverMetrics: window.qaNet.history.at(-1)?.metrics,
          }
        : null,
    );
    if (metric?.traces?.length) {
      const trace = metric.traces;
      metric.traceSummary = Object.fromEntries(
        [
          "createdToSendMs",
          "receiveToTickMs",
          "tickToBroadcastMs",
          "totalMs",
        ].map((key) => {
          const values = trace.map((t) => t[key]).sort((a, b) => a - b);
          return [
            key,
            {
              samples: values.length,
              median: values[Math.floor(values.length * 0.5)],
              p95: values[Math.floor(values.length * 0.95)],
              max: values.at(-1),
            },
          ];
        }),
      );
      metric.traces = trace.slice(-12);
    }
    profiles.push({
      ...settings,
      lossModel: "ordered 200ms retransmission stall",
      samples,
      metrics: metric,
    });
    console.log("profile", settings, samples);
  }
  Object.assign(profile, { rtt: 0, jitter: 0, loss: 0 });
  let recovery = null,
    combat = null;
  if (!before) {
    const identity = await b.evaluate(() => ({
      id: window.qaNet.id,
      hp: window.qaNet.game.players.find((p) => p.id === window.qaNet.id).hp,
    }));
    await b.reload();
    await b.locator(".game-hud").waitFor();
    await b.waitForFunction(() => window.qaNet?.authenticated);
    const restored = await b.evaluate(() => ({
      id: window.qaNet.id,
      hp: window.qaNet.game.players.find((p) => p.id === window.qaNet.id).hp,
    }));
    assert.deepEqual(restored, identity);
    recovery = { sameTabRefresh: true, samePlayerAndHP: true };
    const before = await a.evaluate(() => window.qaNet.game.time);
    await b.evaluate(() => {
      window.qaNet.stopped = true;
      window.qaNet.socket.close(1000, "Test disconnect");
    });
    await a.waitForTimeout(300);
    assert.ok(await a.evaluate((t) => window.qaNet.game.time > t, before));
    await b.evaluate(() => {
      window.qaNet.stopped = false;
      window.qaNet.open();
    });
    await b.waitForFunction(() => window.qaNet.authenticated);
    recovery.temporaryReconnect = true;
  }
  if (!before) {
    const fixture = await mf.fixture(room),
      g = fixture.room.game;
    adminTeleport(g, 1, 1);
    g.spawnBudget = 0;
    g.spawnWarnings = [];
    g.remainingSpawnGroups = 0;
    g.enemies = [];
    g.obstacles = [];
    g.bullets = [];
    g.hazards = [];
    g.intro = 0;
    for (const [i, p] of g.players.entries())
      Object.assign(p, {
        x: i ? 100 + i * 80 : 200,
        y: i ? 420 : 200,
        hp: 100,
        maxHp: 100,
        invuln: 0,
        stun: 0,
        attackCd: 0,
        parryCd: 0,
        damage: 10,
        kitId: "fixture",
      });
    for (const [kind, x, y] of [
      ["brawler", 245, 200],
      ["bow", 255, 220],
    ])
      Object.assign(spawnEnemy(g, kind, x, y), {
        hp: 1,
        stun: 10,
        cooldown: 100,
      });
    const seeded = await mf.fixture(room, "seed", fixture.room);
    await a.waitForFunction(
      (epoch) => window.qaNet?.epoch === epoch,
      seeded.epoch,
    );
    const target = await a.evaluate(() => {
      const r = document.querySelector("canvas").getBoundingClientRect(),
        g = window.qaNet.game,
        scale = Math.min((r.width - 24) / g.width, (r.height - 24) / g.height);
      return {
        x: r.left + (r.width - g.width * scale) / 2 + 250 * scale,
        y: r.top + (r.height - g.height * scale) / 2 + 210 * scale,
      };
    });
    await a.locator("canvas").focus();
    await a.mouse.move(target.x, target.y);
    await a.mouse.down();
    await a.waitForTimeout(120);
    await a.mouse.up();
    await a.locator(".upgrade-card").first().waitFor();
    for (const p of pages) await p.locator(".upgrade-card").first().waitFor();
    await a.screenshot({ path: join(output, "four-player-rewards.png") });
    await a.waitForTimeout(250);
    for (const p of pages) await p.locator(".upgrade-card").first().click();
    await a.waitForFunction(() => window.qaNet.game.phase === "route");
    combat = {
      controlledFixture: true,
      actualServerMeleeClear: true,
      fourIndependentRewards: true,
      routeAfterAllConfirm: true,
    };
  }
  const floors = [];
  if (!before && process.env.MP_FLOORS) {
    for (const [runType, level, room] of [
      ["story", 1, 5],
      ["story", 2, 5],
      ["story", 3, 5],
      ["endless", 1, 30],
    ]) {
      const session = await a.evaluate(() => window.qaNet.session);
      const f = await mf.fixture(session.code);
      const g = createRun(f.room.game.players, 42, runType);
      f.room.game = g;
      f.room.runType = runType;
      for (const p of g.players) {
        p.hp = p.maxHp = 100000;
        p.chosen = false;
      }
      adminTeleport(g, level, room);
      await mf.fixture(session.code, "seed", f.room);
      for (const p of pages) {
        await p.keyboard.down("d");
        await p.keyboard.down("q");
      }
      await a.waitForTimeout(900);
      for (const p of pages) {
        await p.keyboard.up("d");
        await p.keyboard.up("q");
        await p.keyboard.down("a");
      }
      await a.waitForTimeout(900);
      for (const p of pages) await p.keyboard.up("a");
      floors.push(
        await a.evaluate(() => ({
          runType: window.qaNet.game.runType,
          stage: window.qaNet.game.stage,
          room: window.qaNet.game.combatRoom || window.qaNet.game.room,
          players: window.qaNet.game.players.length,
          enemies: window.qaNet.game.enemies.length,
          tick: window.qaNet.history.at(-1).tick,
          pending: window.qaNet.frames.length,
        })),
      );
    }
  }
  let profiling = null;
  if (cdp) {
    const end = new Promise((resolve) =>
      cdp.once("Tracing.tracingComplete", resolve),
    );
    await cdp.send("Tracing.end");
    await end;
    const gc = traceEvents.filter(
      (e) => e.ph === "X" && /MinorGC|MajorGC/.test(e.name),
    );
    const tasks = traceEvents.filter(
      (e) => e.ph === "X" && e.name === "RunTask",
    );
    profiling = {
      method:
        "Chrome DevTools Protocol timeline (one of four renderer contexts)",
      gcEvents: gc.length,
      gcTotalMs: gc.reduce((n, e) => n + (e.dur || 0) / 1000, 0),
      gcMaxMs: Math.max(0, ...gc.map((e) => (e.dur || 0) / 1000)),
      longTasks: tasks.filter((e) => e.dur > 50000).length,
    };
  }
  for (const p of pages)
    clients.push(
      await p.evaluate(() =>
        window.qaNet
          ? {
              id: window.qaNet.id,
              party: window.qaNet.game.players.length,
              tick: window.qaNet.history.at(-1).tick,
              pendingFrames: window.qaNet.frames.length,
            }
          : {},
      ),
    );
  assert.deepEqual(errors, []);
  if (!before) assert.ok(clients.every((c) => c.party === 4));
  const result = {
    source: before ? source : "current",
    browserClients: 4,
    scene: "physical kit draft (combat controls remain enabled)",
    profiles,
    renderCadence: process.env.MP_MIXED_FPS
      ? "test-only timer cadence 30/60/120/144; not physical monitor refresh"
      : "native headless requestAnimationFrame",
    floors,
    profiling,
    recovery,
    combat,
    wire,
    pageErrors: errors,
    kernelPacketLossTested: false,
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    "Browser verification complete",
    JSON.stringify({ clients: clients.length, recovery, errors }),
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
