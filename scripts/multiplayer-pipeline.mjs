import { driver, sleep } from "../tests/helpers/room-driver.js";
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { SnapshotEncoder } from "../game/snapshot-wire.js";
const d = await driver(),
  out = process.env.MP_OUTPUT || "docs/multiplayer-smoothness";
const stats = (a) => {
  a = a.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    samples: a.length,
    median: a[Math.floor(a.length * 0.5)],
    p95: a[Math.floor(a.length * 0.95)],
    max: a.at(-1),
  };
};
try {
  const sessions = await d.party(4),
    clients = [];
  for (const s of sessions)
    clients.push(await d.socket(s, { binary: true, ack: "piggyback" }));
  const start = performance.now();
  for (let i = 0; i < 150; i++) {
    for (const c of clients) {
      const at = performance.now();
      c.send({
        type: "input",
        commands: [
          {
            seq: ++c.seq,
            input: { mx: i % 60 < 30 ? 1 : -1, angle: 0 },
            createdAt: at,
            sentAt: at,
          },
        ],
      });
    }
    await sleep(1000 / 60);
  }
  await sleep(80);
  const rows = clients.flatMap((c) => {
      const seen = new Set();
      return c.messages
        .filter(
          (m) => m.trace && !seen.has(m.trace.seq) && seen.add(m.trace.seq),
        )
        .map((m) => ({
          seq: m.trace.seq,
          total: m.clientReceivedAt - m.trace.createdAt,
          queue: m.trace.appliedAt - m.trace.receivedAt,
          broadcast: m.trace.broadcastAt - m.trace.appliedAt,
        }));
    }),
    encoder = new SnapshotEncoder(),
    snapshots = clients[0].messages.filter((m) => m.type === "snapshot"),
    sizes = snapshots.map((m) => ({
      json: Buffer.byteLength(JSON.stringify(m)),
      binary: encoder.encode(m).byteLength,
    }));
  const result = {
    method:
      "four actual local DO/WebSocket clients; command creation through full authoritative snapshot receipt; no browser renderer",
    elapsedMs: performance.now() - start,
    ackMs: stats(rows.map((r) => r.total)),
    receiveToTickMs: stats(rows.map((r) => r.queue)),
    tickToBroadcastMs: stats(rows.map((r) => r.broadcast)),
    meanJsonBytes: sizes.reduce((n, s) => n + s.json, 0) / sizes.length,
    meanBinaryBytes: sizes.reduce((n, s) => n + s.binary, 0) / sizes.length,
    metrics: clients[0].latest.metrics,
  };
  await mkdir(out, { recursive: true });
  await writeFile(out + "/pipeline.json", JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await d.close();
}
