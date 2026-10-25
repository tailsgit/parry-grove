// Actual production room API + Durable Objects, four isolated browser sessions.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
const baseline = !!process.env.MENU_BASELINE,
  output = process.env.MENU_OUTPUT || "docs/menu-lobby/after";
const template = await readFile("tests/ui-preview.html", "utf8"),
  code = template.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const ui = await build({
  stdin: {
    contents: code,
    resolveDir: process.cwd() + "/tests",
    loader: "jsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  plugins: baseline
    ? [
        {
          name: "baseline-menu",
          setup(b) {
            b.onLoad({ filter: /game\/Game\.jsx$/ }, () => ({
              loader: "jsx",
              contents: execFileSync(
                "git",
                ["show", "origin/main:game/Game.jsx"],
                { encoding: "utf8" },
              ),
            }));
          },
        },
      ]
    : [],
});
const worker = await build({
  stdin: {
    contents: `import{env}from'cloudflare:workers';import{POST}from'./app/api/room/route.ts';import{GET}from'./app/api/room/socket/route.ts';export{RoomRealtime}from'./game/room-realtime.ts';export default{fetch:r=>{const p=new URL(r.url).pathname;return p==='/api/room/socket'?GET(r):p==='/api/room'?POST(r):new Response(p==='/qa.js'?env.QA_JS:p.endsWith('.css')?env.QA_CSS:env.QA_HTML,{headers:{'Content-Type':p==='/qa.js'?'text/javascript':p.endsWith('.css')?'text/css':'text/html'}})}};`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  tsconfig: "tsconfig.json",
});
const mf = new Miniflare({
  cf: false,
  modules: true,
  script: worker.outputFiles[0].text,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  durableObjects: { ROOMS: "RoomRealtime" },
  bindings: {
    QA_JS: ui.outputFiles[0].text,
    QA_HTML: template.replace(
      /<script type="module">[\s\S]*<\/script>/,
      '<script type="module" src="/qa.js"></script>',
    ),
    QA_CSS: baseline
      ? execFileSync("git", ["show", "origin/main:app/globals.css"], {
          encoding: "utf8",
        })
      : await readFile("app/globals.css", "utf8"),
  },
});
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
let browser;
try {
  await mkdir(output, { recursive: true });
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
  const errors = [],
    contexts = [],
    responses = [];
  const origin = (await mf.ready).toString();
  async function page(viewport = { width: 1280, height: 800 }) {
    const c = await browser.newContext({ viewport });
    contexts.push(c);
    await c.grantPermissions(["clipboard-read", "clipboard-write"]);
    await c.addInitScript(() =>
      localStorage.setItem("parry-grove-practice", "skipped"),
    );
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("response", async (r) => {
      if (
        r.url().includes("/api/room") &&
        !r.url().includes("socket") &&
        r.request().method() === "POST"
      ) {
        try {
          responses.push({ status: r.status(), body: await r.json() });
        } catch {}
      }
    });
    p.setDefaultTimeout(12000);
    return p;
  }
  const a = await page();
  await a.goto(origin);
  await a.getByRole("button", { name: "Play solo" }).waitFor();
  const menu = await a.locator(".menu-card").boundingBox();
  const tokens = await a
    .getByRole("button", { name: "Play solo" })
    .evaluate((e) => {
      const c = getComputedStyle(e);
      return {
        background: c.backgroundColor,
        color: c.color,
        font: c.fontFamily,
        borderRadius: c.borderRadius,
      };
    });
  await a.screenshot({ path: output + "/menu.png" });
  if (baseline) {
    await writeFile(
      output + "/results.json",
      JSON.stringify({ menu, tokens }, null, 2),
    );
  } else {
    await a.getByLabel("Adventurer name").fill("Taila");
    await a.reload();
    await a.getByLabel("Adventurer name").waitFor();
    assert.equal(await a.getByLabel("Adventurer name").inputValue(), "Taila");
    await a.getByRole("button", { name: "Create co-op room" }).click();
    await a.getByRole("heading", { name: "Gather at the grove." }).waitFor();
    await a.getByRole("button", { name: "Start run" }).waitFor();
    const room = await a.getByLabel("Room code", { exact: true }).inputValue();
    assert.match(room, /^[A-Z2-9]{6}$/);
    await a.getByRole("button", { name: "Copy code", exact: true }).click();
    assert.equal(await a.evaluate(() => navigator.clipboard.readText()), room);
    await a
      .getByRole("button", { name: "Copy code", exact: true })
      .filter({ hasText: "Copied!" })
      .waitFor();
    await a
      .getByRole("button", { name: "Copy invite link", exact: true })
      .click();
    const invite = await a.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(invite).searchParams.get("room"), room);
    assert.ok(!invite.includes("token"));
    const b = await page();
    await b.goto(origin);
    await b.getByLabel("Adventurer name").fill("Birch");
    await b.getByLabel("Six-character room code").fill(room.toLowerCase());
    await b.getByLabel("Six-character room code").press("Enter");
    await b.getByRole("heading", { name: "Gather at the grove." }).waitFor();
    const c = await page();
    await c.goto(invite);
    await c.getByRole("heading", { name: "Gather at the grove." }).waitFor();
    const d = await page();
    await d.goto(invite);
    await d.getByRole("heading", { name: "Gather at the grove." }).waitFor();
    await d.reload();
    await d.getByRole("heading", { name: "Gather at the grove." }).waitFor();
    assert.equal(
      await d.getByLabel("Room code", { exact: true }).inputValue(),
      room,
    );
    await a.waitForFunction(
      () =>
        document.querySelectorAll(".party-slot:not(.is-empty)").length === 4,
    );
    assert.equal(await b.getByLabel("Party route", { exact: true }).count(), 0);
    assert.equal(
      await a.getByRole("button", { name: "Start run" }).isDisabled(),
      true,
    );
    for (const p of [b, c, d])
      await p.getByRole("button", { name: "Ready up" }).click();
    await a
      .getByRole("button", { name: "Start run" })
      .waitFor({ state: "visible" });
    await a.waitForFunction(
      () => !document.querySelector(".entry-card .primary").disabled,
    );
    await a.getByLabel("Party route", { exact: true }).selectOption("endless");
    await b.getByText("ENDLESS", { exact: true }).waitFor();
    await a.waitForFunction(
      () =>
        document.querySelectorAll(".party-ready:not(.is-ready)").length === 3,
    );
    for (const p of [b, c, d])
      await p.getByRole("button", { name: "Ready up" }).click();
    await a.waitForFunction(
      () =>
        document.querySelectorAll(".party-ping").length === 4 &&
        [...document.querySelectorAll(".party-ping")].every((e) =>
          /\d+ ms/.test(e.textContent),
        ),
    );
    await a.screenshot({ path: output + "/party.png" });
    const lobby = await a.locator(".entry-card").boundingBox(),
      pings = await a.locator(".party-ping").allTextContents();
    await b.keyboard.press("Escape");
    await b.getByRole("heading", { name: "Choose your route." }).waitFor();
    await a.waitForFunction(
      () =>
        document.querySelectorAll(".party-slot:not(.is-empty)").length === 3,
    );
    await b.getByLabel("Six-character room code").fill(room);
    await b.getByLabel("Six-character room code").press("Enter");
    await b.getByRole("button", { name: "Ready up" }).click();
    await a.waitForFunction(
      () => !document.querySelector(".entry-card .primary").disabled,
    );
    await a.getByRole("button", { name: "Start run" }).click();
    await a.waitForFunction(
      () =>
        !document.querySelector(".entry-card") &&
        document.querySelector(".room-hud")?.textContent.includes("ENDLESS"),
    );
    for (const p of [b, c, d])
      await p.waitForFunction(
        () =>
          !document.querySelector(".entry-card") &&
          !!document.querySelector(".room-hud"),
      );
    // Error feedback, solo entry and small viewport keyboard/focus path use fresh sessions.
    const small = await page({ width: 390, height: 844 });
    await small.goto(origin);
    await small.getByLabel("Six-character room code").fill("ZZZZZZ");
    await small.getByLabel("Six-character room code").press("Enter");
    await small.getByRole("alert").waitFor();
    assert.ok(
      await small
        .getByRole("heading", { name: "Choose your route." })
        .isVisible(),
    );
    await small.getByLabel("Six-character room code").press("Escape");
    assert.equal(
      await small.evaluate(() => document.activeElement.id),
      "entry-title",
    );
    await small.keyboard.press("Tab");
    assert.equal(
      await small.evaluate(() => document.activeElement.tagName),
      "BUTTON",
    );
    const focus = await small.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { color: s.outlineColor, width: s.outlineWidth };
    });
    assert.equal(
      await small.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await small.screenshot({ path: output + "/mobile.png" });
    await small.evaluate(() =>
      localStorage.setItem(
        "parry-grove-preferences",
        JSON.stringify({ reduced: true }),
      ),
    );
    await small.reload();
    await small.getByRole("button", { name: "Play solo" }).hover();
    assert.equal(
      await small
        .getByRole("button", { name: "Play solo" })
        .evaluate((e) => getComputedStyle(e).transform),
      "none",
    );
    await small.getByRole("button", { name: "Play solo" }).click();
    await small.waitForFunction(
      () =>
        !document.querySelector(".entry-card") &&
        !!document.querySelector(".game-hud"),
    );
    const sound = await page();
    await sound.goto(origin);
    await sound
      .getByRole("button", { name: "Mute sound", exact: true })
      .click();
    await sound
      .getByRole("button", { name: "Enable sound", exact: true })
      .waitFor();
    await sound.getByRole("button", { name: "Create co-op room" }).click();
    await sound.getByRole("button", { name: "Start run" }).waitFor();
    assert.ok(
      await sound
        .getByRole("button", { name: "Enable sound", exact: true })
        .isVisible(),
    );
    await sound.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async () => {
            throw Error("Clipboard denied");
          },
        },
        configurable: true,
      }),
    );
    await sound
      .getByRole("button", { name: "Copy invite link", exact: true })
      .click();
    const fallback = await sound
      .getByLabel("Invite link", { exact: true })
      .inputValue();
    assert.ok(new URL(fallback).searchParams.get("room"));
    assert.deepEqual(errors, []);
    const result = {
      menu,
      lobby,
      tokens,
      pings,
      focus,
      clients: 4,
      checks: {
        namePersisted: true,
        inlineJoinEnter: true,
        inviteAutoJoin: true,
        sameTabLobbyRefresh: true,
        clipboard: true,
        guestRouteReadOnly: true,
        routeChangeResetsGuestReady: true,
        liveMeasuredPings: true,
        escapeLeaveAndRejoin: true,
        fourClientEndlessStart: true,
        mobileNoHorizontalOverflow: true,
        soloStart: true,
        mutePreserved: true,
        clipboardFallback: true,
        reducedMotion: true,
      },
      pageErrors: errors,
    };
    await writeFile(output + "/results.json", JSON.stringify(result, null, 2));
    console.log(result);
  }
} finally {
  await browser?.close();
  await mf.dispose();
}
