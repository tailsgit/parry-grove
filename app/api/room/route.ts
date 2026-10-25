import { env } from "cloudflare:workers";
import { member, roomState } from "@/game/rooms.js";
import {
  NET,
  protocol,
  readBody,
  ACTIVE_ACTIONS,
} from "@/game/net-protocol.js";
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    protocol(body.version);
    if (!env.DB || !env.ROOMS)
      throw Object.assign(
        Error("Online rooms are unavailable. Solo play still works."),
        { status: 503 },
      );
    if (["create", "join"].includes(body.action) && env.ROOM_ADMISSION) {
      const result = await env.ROOM_ADMISSION.limit({
        key: "room:" + request.headers.get("CF-Connecting-IP"),
      });
      if (!result.success)
        throw Object.assign(
          Error("Too many room attempts. Please wait a minute."),
          { status: 429 },
        );
    }
    let session;
    if (body.action === "create") {
      const now = Date.now(),
        m = member(body.name, body.weapon, now),
        r = roomState(m, now, body.runType),
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      // Live rooms update metadata; cleanup never deletes an active-run marker.
      await env.DB.prepare(
        "DELETE FROM game_rooms WHERE updated_at < ? AND json_extract(state,'$.game') IS NULL",
      )
        .bind(now - 6 * 3600000)
        .run();
      for (let tries = 0; tries < 6; tries++) {
        const code = [...crypto.getRandomValues(new Uint8Array(6))]
          .map((b) => alphabet[b % alphabet.length])
          .join("");
        const result = await env.DB.prepare(
          "INSERT OR IGNORE INTO game_rooms(code,state,revision,updated_at) VALUES(?,?,0,?)",
        )
          .bind(code, JSON.stringify(r), now)
          .run();
        if (result.meta.changes) {
          session = { id: m.id, token: m.token };
          Object.assign(body, { code, ...session, action: "resume" });
          break;
        }
      }
      if (!session) throw Error("Could not create room. Retry shortly.");
    }
    if (!ACTIVE_ACTIONS.has(body.action)) throw Error("Unknown room action.");
    const code = String(body.code || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code))
      throw Error("Enter a valid six-character room code.");
    // D1 is discovery/metadata only after room creation. Every read and mutation
    // reaches the same room owner, including lobby operations and HTTP fallback.
    const result = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(
      new Request("https://room.internal/state?code=" + code, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const data = (await result.json()) as Record<string, unknown>;
    return Response.json(
      { ...data, ...(session && result.ok ? { session } : {}) },
      {
        status: result.status,
        headers: {
          "Cache-Control": "no-store",
          "X-Game-Protocol": String(NET.version),
        },
      },
    );
  } catch (error) {
    const e = error as Error & { status?: number };
    return Response.json(
      { error: e.message || "Room request failed." },
      { status: e.status || 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
