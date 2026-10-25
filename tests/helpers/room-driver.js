import {
  decodeSnapshot,
  SNAPSHOT_WIRE_VERSION,
} from "../../game/snapshot-wire.js";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { NetworkTestMiniflare, networkFixturePlugin } from "./multiplayer.js";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function driver(options = {}) {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
  process.env.WRANGLER_SEND_METRICS = "false";
  const b = await build({
      stdin: {
        contents:
          "import{POST}from'./app/api/room/route.ts';import{GET}from'./app/api/room/socket/route.ts';export{RoomRealtime}from'./game/room-realtime.ts';export default{fetch:r=>r.headers.get('Upgrade')?GET(r):POST(r)};",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      plugins: [networkFixturePlugin],
      external: ["cloudflare:workers"],
      tsconfig: "tsconfig.json",
    }),
    mf = new NetworkTestMiniflare({
      cf: false,
      modules: true,
      script: b.outputFiles[0].text,
      compatibilityDate: "2026-05-15",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { ENABLE_DEV_TOOLS: "true" },
      d1Databases: ["DB"],
      ...(options.admissionLimit
        ? {
            ratelimits: {
              ROOM_ADMISSION: {
                simple: { limit: options.admissionLimit, period: 60 },
              },
              ROOM_SOCKET_ADMISSION: {
                simple: { limit: options.admissionLimit, period: 60 },
              },
            },
          }
        : {}),
    }),
    sockets = [],
    states = new Map(),
    actions = new Map();
  const db = await mf.getD1Database("DB");
  await db.exec(
    (await readFile("drizzle/0000_happy_kang.sql", "utf8")).replaceAll(
      "\n",
      " ",
    ),
  );
  const http = async (body, s = {}) => {
    const actionSeq = (actions.get(s.id) || 0) + 1;
    actions.set(s.id, actionSeq);
    const response = await mf.rawFetch("http://test/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2,
          runId: states.get(s.code || body.code)?.runId,
          actionId: crypto.randomUUID(),
          actionSeq,
          ...s,
          ...body,
        }),
      }),
      data = await response.json();
    if (data.code) states.set(data.code, data);
    return { status: response.status, data };
  };
  const party = async (count = 2, runType = "endless") => {
    const c = await http({ action: "create", runType }),
      sessions = [{ code: c.data.code, ...c.data.session }];
    if (c.status !== 200) throw Error(JSON.stringify(c));
    for (let i = 1; i < count; i++) {
      const j = await http({
        action: "join",
        code: c.data.code,
        name: "P" + i,
      });
      if (j.status !== 200) throw Error(JSON.stringify(j));
      sessions.push({ code: c.data.code, ...j.data.session });
    }
    for (const s of sessions) await http({ action: "ready" }, s);
    const start = await http({ action: "start" }, sessions[0]);
    if (start.status !== 200) throw Error(JSON.stringify(start));
    return sessions;
  };
  const socket = async (
    s,
    {
      auth = true,
      ack = true,
      rtt = 0,
      jitter = 0,
      loss = 0,
      binary = false,
      binaryVersion = SNAPSHOT_WIRE_VERSION,
    } = {},
  ) => {
    const response = await mf.rawFetch(
        "http://test/api/room/socket?code=" + s.code,
        { headers: { Upgrade: "websocket" } },
      ),
      ws = response.webSocket;
    if (!ws) return { status: response.status };
    ws.accept();
    sockets.push(ws);
    const client = {
      ws,
      status: response.status,
      messages: [],
      latest: null,
      seq: 0,
      closed: false,
      sent: 0,
      dropped: 0,
      confirmation: [],
      binarySnapshots: 0,
    };
    let serial = 0;
    const delayed = (fn) => {
      const delay = Math.max(
        0,
        rtt / 2 + (jitter ? ((serial++ % 3) - 1) * jitter : 0),
      );
      setTimeout(fn, delay);
    };
    client.send = (m) => {
      client.sent++;
      if (m.type === "action") {
        m.actionSeq = (actions.get(s.id) || 0) + 1;
        actions.set(s.id, m.actionSeq);
      }
      if (loss && client.sent % Math.round(100 / loss) === 0) {
        client.dropped++;
        return;
      }
      delayed(() => {
        try {
          ws.send(
            JSON.stringify({
              version: 2,
              runId: client.latest?.runId || states.get(s.code)?.runId,
              epoch: client.latest?.epoch || states.get(s.code)?.epoch,
              snapshotAck: ack ? client.latest?.sequence || 0 : 0,
              eventAck: client.latest?.game?.events.at(-1)?.id || 0,
              ...m,
            }),
          );
        } catch {}
      });
    };
    ws.addEventListener("message", (e) =>
      delayed(() => {
        if (typeof e.data !== "string") client.binarySnapshots++;
        const m =
          typeof e.data === "string"
            ? JSON.parse(e.data)
            : decodeSnapshot(e.data);
        Object.defineProperty(m, "clientReceivedAt", {
          value: performance.now(),
          enumerable: false,
        });
        client.messages.push(m);
        if (m.type === "snapshot") {
          client.latest = m;
          states.set(s.code, m);
          if (ack === true) client.send({ type: "ack" });
          if (m.probe) client.send({ type: "probeReply", nonce: m.probe });
        }
      }),
    );
    ws.addEventListener("close", () => (client.closed = true));
    if (auth) {
      client.send({
        type: "auth",
        id: s.id,
        token: s.token,
        binary,
        binaryVersion,
      });
      for (let n = 0; n < 100 && !client.latest; n++) await sleep(10);
      if (!client.latest)
        throw Error("Auth timed out " + JSON.stringify(client.messages));
    }
    return client;
  };
  return {
    mf,
    http,
    party,
    socket,
    states,
    fixture: (code, op, room) => mf.fixture(code, op, room),
    close: async () => {
      for (const s of sockets)
        try {
          s.close();
        } catch {}
      await mf.dispose();
    },
  };
}
