// Test-only bridge: old tests seeded/read D1 as if it owned live combat. Fixtures
// now explicitly inspect/seed the authoritative DO; production has no such routes.
import { Miniflare } from "miniflare";
export const networkFixturePlugin = {
  name: "network-fixture",
  setup(b) {
    b.onLoad({ filter: /game\/room-realtime\.ts$/ }, () => ({
      loader: "js",
      contents: `
import {RoomRealtime as ProductionRoom} from './room-server.js';
import {RoomSimulation} from './room-simulation.js';
export class RoomRealtime extends ProductionRoom{
 async fetch(request){const url=new URL(request.url);if(url.pathname.startsWith('/__test/')){await this.load(url.searchParams.get('code'));if(url.pathname==='/__test/seed'){clearTimeout(this.timer);this.timer=null;this.room=await request.json();const active=new Set(this.room.members.filter(m=>!m.disconnected).map(m=>m.id));this.sim=new RoomSimulation(this.room,{},Date.now());for(const m of this.room.members){if(active.has(m.id))this.sim.touch(m.id,Date.now());}this.sim.expire(Date.now());this.sim.commitEvents(this.room.game?.events);this.receipts.clear();await this.persist(true);this.ensureLoop();}if(url.pathname==='/__test/fail')this.failNext=true;if(url.pathname==='/__test/reset'){await this.persist(true);this.ctx.abort('Injected reconstruction');}return Response.json({room:this.room,runId:this.sim.runId,epoch:this.sim.epoch,tick:this.sim.tick,metrics:this.sim.metrics,now:Date.now(),timer:!!this.timer,controllers:[...this.controllers.keys()],sockets:this.ctx.getWebSockets('transport').map(s=>{const a=s.deserializeAttachment();return {id:!!a.id,closed:!!a.closed,deadline:a.deadline,sent:a.sent,ack:a.ack,lastAck:a.lastAck,readyState:s.readyState};})});}return super.fetch(request);}
 async writeCheckpoint(value,allowUnconfirmed){if(this.failNext){this.failNext=false;throw Error('Injected checkpoint failure');}return super.writeCheckpoint(value,allowUnconfirmed);}
}
`,
    }));
  },
};
export class NetworkTestMiniflare extends Miniflare {
  constructor(options) {
    super({
      ...options,
      durableObjects: { ROOMS: "RoomRealtime", ...options.durableObjects },
    });
    this.codes = new Map();
    this.seqs = new Map();
    this.actionSeqs = new Map();
    this.controllerIds = new Map();
    this.nativeFetch = this.dispatchFetch.bind(this);
    this.dispatchFetch = this.enhancedFetch.bind(this);
  }
  async fixture(code, operation = "inspect", room) {
    const ns = await super.getDurableObjectNamespace("ROOMS");
    const response = await ns
      .get(ns.idFromName(code))
      .fetch("http://fixture/__test/" + operation + "?code=" + code, {
        method: room ? "POST" : "GET",
        ...(room ? { body: JSON.stringify(room) } : {}),
      });
    const data = await response.json();
    if (data.runId) this.codes.set(code, { ...this.codes.get(code), ...data });
    return data;
  }
  async getD1Database(binding) {
    const db = await super.getD1Database(binding);
    return new Proxy(db, {
      get: (target, key) => {
        if (key === "prepare")
          return (sql) => {
            const prepared = target.prepare(sql);
            return {
              bind: (...args) => {
                const bound = prepared.bind(...args);
                return new Proxy(bound, {
                  get: (statement, method) => {
                    if (method === "first" && /SELECT state/i.test(sql))
                      return async () => {
                        if (this.codes.has(args[0])) {
                          const data = await this.fixture(args[0]);
                          return {
                            state: JSON.stringify(data.room),
                            revision: 0,
                          };
                        }
                        return statement.first();
                      };
                    if (
                      method === "run" &&
                      /UPDATE game_rooms SET state/i.test(sql)
                    )
                      return async () => {
                        const result = await statement.run();
                        const room = JSON.parse(args[0]),
                          code = args.at(-1);
                        await this.fixture(code, "seed", room);
                        for (const m of room.members) this.seqs.delete(m.id);
                        return result;
                      };
                    const value = statement[method];
                    return typeof value === "function"
                      ? value.bind(statement)
                      : value;
                  },
                });
              },
              run: () => prepared.run(),
            };
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  async rawFetch(...args) {
    return this.nativeFetch(...args);
  }
  async enhancedFetch(url, options = {}) {
    if (!options.body && !options.headers?.Upgrade)
      return this.nativeFetch(url, options);
    if (options.headers?.Upgrade === "websocket") {
      const response = await this.nativeFetch(url, options),
        socket = response.webSocket;
      if (!socket) return response;
      let identity, latest;
      const send = socket.send.bind(socket);
      socket.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "snapshot") {
          latest = m;
          if (identity) this.controllerIds.set(identity, m.controller);
          this.codes.set(m.code, m);
        }
        if (m.probe)
          send(
            JSON.stringify({ version: 2, type: "probeReply", nonce: m.probe }),
          );
      });
      socket.send = (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "auth") identity = m.id;
        const state =
          latest || this.codes.get(new URL(url).searchParams.get("code"));
        if (m.type === "action")
          this.actionSeqs.set(
            identity,
            (this.actionSeqs.get(identity) || 0) + 1,
          );
        if (m.type === "input") {
          m.seq = (this.seqs.get(identity) || 0) + 1;
          this.seqs.set(identity, m.seq);
        }
        send(
          JSON.stringify({
            version: 2,
            runId: state?.runId,
            epoch: state?.epoch,
            snapshotAck: latest?.sequence || 0,
            eventAck: latest?.game?.events?.at(-1)?.id || 0,
            actionId: crypto.randomUUID(),
            actionSeq: this.actionSeqs.get(identity) || 1,
            ...m,
          }),
        );
      };
      return response;
    }
    const body = JSON.parse(options.body || "{}"),
      state = this.codes.get(body.code);
    if (body.action === "input") {
      const p = (state?.room?.game || state?.game)?.players.find(
        (p) => p.id === body.id,
      );
      body.input = {
        parry: p?.seenParry || 0,
        dash: p?.seenDash || 0,
        attackPress: p?.seenAttack || 0,
        interact: p?.seenInteract || 0,
        ...body.input,
      };
      body.seq = (this.seqs.get(body.id) || 0) + 1;
      this.seqs.set(body.id, body.seq);
    }
    const actionSeq = (this.actionSeqs.get(body.id) || 0) + 1;
    this.actionSeqs.set(body.id, actionSeq);
    const response = await this.nativeFetch(url, {
      ...options,
      body: JSON.stringify({
        version: 2,
        runId: state?.runId,
        epoch: state?.epoch,
        actionId: crypto.randomUUID(),
        actionSeq,
        controller: this.controllerIds.get(body.id),
        ...body,
      }),
    });
    const data = await response.clone().json();
    if (response.status >= 400)
      console.log("[test response]", body.action, response.status, data.error);
    if (data.code) this.codes.set(data.code, data);
    if (body.action === "input" && response.ok) {
      await new Promise((r) => setTimeout(r, 40));
      const polled = await this.nativeFetch(url, {
        ...options,
        body: JSON.stringify({
          version: 2,
          action: "poll",
          code: body.code,
          id: body.id,
          token: body.token,
        }),
      });
      const snap = await polled.clone().json();
      if (snap.code) this.codes.set(snap.code, snap);
      return polled;
    }
    return response;
  }
}
