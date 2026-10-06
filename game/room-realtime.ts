import { DurableObject } from 'cloudflare:workers';
import { advanceRoom, applyAction, cleanInput, publicRoom } from './rooms.js';

const SNAPSHOT_INTERVAL = 33;
const PERSIST_INTERVAL = 250;
const SNAPSHOT_EVENTS = 18;

type Game = Omit<ReturnType<typeof import('./engine.js').createGame>,'events'> & {scenerySeed?:number;runSystems?:boolean;hostId?:string;scrap?:number;kits?:unknown[];routeOptions?:string[];routeDoors?:Array<{choice:string;x:number;y:number;side:string}>;pendingRoom?:number;station?:{x:number;y:number};exit?:{x:number;y:number};stock?:unknown[];altarOffers?:string[];stopSerial?:number;shopStartedAt?:number;doorsOpenedAt?:number;events:Array<{time:number} & Record<string,unknown>>};

type RealtimeMember = { id:string; token:string; name:string; weapon:string; ready:boolean; slot:number; lastSeen:number };
type RealtimeRoom = {
  host:string;
  members:RealtimeMember[];
  game:Game | null;
  inputs: Record<string, ReturnType<typeof cleanInput>>;
  lastTick: number;
  createdAt: number;
};

function compactGame(game: Game | null) {
  if (!game) return null;
  const pick = (values: Record<string,unknown>[], fields: string[]) => values.map(value => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key,value[key]])));
  const playerFields = ['id','name','weapon','slot','x','y','angle','hp','maxHp','internal','level','xp','shieldDamage','shieldBroken','magnetLeft','damage','speed','armor','perfect','dashLeft','dashCd','dx','dy','invuln','swing','blocking','stun','vx','vy','streak','parryCd','parryLeft','parryAge','upgrades','offers','chosen','kills','perfects','regulars','kitId','healthFactor','shopContacts','vendorOpen','altarOpen','altarUsed','stunBonus','areaScale','returnPower','dashPulse','stunDamage','parryHeal','stunNova','thunderStep','mirror','echoBlade'];
  const enemyFields = ['id','kind','x','y','hp','maxHp','angle','tell','tellTotal','danger','action','swing','guardLeft','stun','recoil','mineState','mineTimer','primed','repositionLeft','repositionX','repositionY'];
  const bulletFields = ['id','x','y','vx','vy','kind','owner','radius','unparryable','ricochet','thrower','wave','waveAge'];
  const hazardFields = ['id','kind','x','y','r','remaining','total','dashOnly','sx','sy','ex','ey','flight','armed','triggerRadius'];
  const events = game.events.filter((event) => game.time-event.time <= 3).slice(-SNAPSHOT_EVENTS);
  return {seed:game.seed,time:game.time,stage:game.stage,room:game.room,phase:game.phase,players:pick(game.players,playerFields),enemies:pick(game.enemies,enemyFields),bullets:pick(game.bullets,bulletFields),hazards:pick(game.hazards,hazardFields),obstacles:game.obstacles,width:game.width,height:game.height,intro:game.intro,scenerySeed:game.scenerySeed,runSystems:game.runSystems,hostId:game.hostId,scrap:game.scrap,kits:game.kits,routeOptions:game.routeOptions,routeDoors:game.routeDoors,pendingRoom:game.pendingRoom,station:game.station,exit:game.exit,stock:game.stock,altarOffers:game.altarOffers,stopSerial:game.stopSerial,shopStartedAt:game.shopStartedAt,doorsOpenedAt:game.doorsOpenedAt,events:pick(events,['id','kind','x','y','text','who','time','radius','sourceKind','weaponAction','itemId'])};
}

function snapshot(code: string, room: RealtimeRoom, revision: number, sequence: number) {
  const state = publicRoom(code,room,revision);
  return {...state,sequence,game:compactGame(state.game)};
}

export class RoomRealtime extends DurableObject<Cloudflare.Env> {
  private room: RealtimeRoom | null = null;
  private code = '';
  private revision = 0;
  private sequence = 0;
  private databaseRevision = 0;
  private loaded: Promise<void> | null = null;
  private lastBroadcast = 0;
  private lastPersist = 0;
  private persistChain: Promise<void> = Promise.resolve();

  private async load(code: string) {
    if (this.loaded && (!this.room || this.room.game)) return this.loaded;
    if (this.loaded) this.loaded=null;
    this.code = code;
    this.loaded = (async () => {
      const saved = await this.ctx.storage.get<{room:RealtimeRoom;revision:number;sequence:number;databaseRevision:number}>('room-state');
      if (saved?.room?.game) {
        this.room = saved.room;
        this.revision = saved.revision;
        this.sequence = saved.sequence ?? 0;
        this.databaseRevision = saved.databaseRevision ?? saved.revision;
        return;
      }
      const row = await this.env.DB?.prepare('SELECT state,revision FROM game_rooms WHERE code = ?').bind(code).first<{state:string;revision:number}>();
      if (!row) throw new Error('Room not found. Check the code.');
      this.room = JSON.parse(row.state) as RealtimeRoom;
      this.revision = row.revision;
      this.sequence = 0;
      this.databaseRevision = row.revision;
    })();
    try { await this.loaded; } catch (error) { this.loaded = null; throw error; }
    return this.loaded;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return Response.json({error:'Enter a valid six-character room code.'},{status:400});
    if (request.method === 'POST') {
      try {
        await this.load(code);
        const body = await request.json() as {id?:string;token?:string;action?:string;input?:Record<string,number|boolean>;operation?:string;level?:number;room?:number;hp?:number;kit?:string;choice?:string;item?:string};
        const member = this.room?.members.find(value => value.id === body.id && value.token === body.token);
        if (!member || !this.room?.game) return Response.json({error:'You have disconnected. Join a new lobby.'},{status:401});
        const now=Date.now();member.lastSeen=now;
        if(['admin','kit','route','buy','sacrifice','vendorClose'].includes(body.action||''))applyAction(this.room,member,body,now);
        else if(body.action==='leave')applyAction(this.room,member,{action:'leave'},now);
        else this.room.inputs[member.id]=cleanInput(body.input||{});
        advanceRoom(this.room,now);this.revision++;
        this.lastBroadcast=now;this.sequence++;this.broadcast({type:'snapshot',...snapshot(this.code,this.room,this.revision,this.sequence)});await this.persist();
        return Response.json(snapshot(this.code,this.room,this.revision,this.sequence),{headers:{'Cache-Control':'no-store'}});
      } catch (error) { return Response.json({error:error instanceof Error?error.message:'Room update failed.'},{status:400}); }
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return Response.json({error:'A WebSocket connection is required.'},{status:426});
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1],['room']);
    // The first message carries the player session so its token does not appear in the URL.
    pair[1].serializeAttachment({code});
    return new Response(null,{status:101,webSocket:pair[0]});
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    let fatal = false;
    try {
      if (typeof raw !== 'string') throw new Error('Unsupported message.');
      const message = JSON.parse(raw) as {type?:string;id?:string;token?:string;input?:Record<string,number|boolean>;action?:string;upgrade?:string;sentAt?:number};
      const attachment = socket.deserializeAttachment() as {code:string;id?:string;token?:string};
      // WebSocket hibernation can resume this socket on a fresh DO instance,
      // where in-memory room state has not been restored yet.
      await this.load(attachment.code);
      if (message.type === 'auth') {
        const member = this.room?.members.find(value => value.id === message.id && value.token === message.token);
        if (!member || !this.room?.game) { fatal = true; throw new Error('You have disconnected. Join a new lobby.'); }
        socket.serializeAttachment({...attachment,id:member.id,token:member.token});
        member.lastSeen = Date.now();
        this.send(socket,{type:'snapshot',...snapshot(this.code,this.room,this.revision,this.sequence)});
        await this.persist();
        return;
      }
      const identity = attachment.id && attachment.token ? {id:attachment.id,token:attachment.token} : null;
      if (!identity || !this.room) { fatal = true; throw new Error('Reconnect to the room.'); }
      const member = this.room.members.find(value => value.id === identity.id && value.token === identity.token);
      if (!member) { fatal = true; throw new Error('You have disconnected. Join a new lobby.'); }
      const now = Date.now();
      member.lastSeen = now;
      if (message.type === 'input') {
        this.room.inputs[member.id] = cleanInput(message.input || {});
      } else if (message.type === 'action' && message.action) {
        applyAction(this.room,member,{action:message.action,upgrade:message.upgrade},now);
      } else if (message.type === 'ping') {
        this.send(socket,{type:'pong',sentAt:message.sentAt});
        return;
      } else {
        throw new Error('Unknown room message.');
      }
      advanceRoom(this.room,now);
      this.sequence++;
      const returning=message.type === 'action' && message.action === 'return';
      if (returning) await this.writeLobbyState();
      if (message.type === 'action' || now-this.lastBroadcast>=SNAPSHOT_INTERVAL) {
        this.lastBroadcast=now;
        this.broadcast({type:'snapshot',...snapshot(this.code,this.room,this.revision,this.sequence)});
      }
      if (returning) {
        for (const client of this.ctx.getWebSockets('room')) client.close(1000,'Returned to lobby');
      }
      await this.persist(returning);
    } catch (error) {
      this.send(socket,{type:'error',message:error instanceof Error?error.message:'Room connection failed.',fatal});
    }
  }

  async webSocketClose(socket: WebSocket) {
    try { socket.close(1000,'Connection closed'); } catch {}
  }

  private send(socket: WebSocket, message: unknown) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: unknown) {
    for (const socket of this.ctx.getWebSockets('room')) this.send(socket,message);
  }

  private persist(force=false) {
    if (!this.room) return Promise.resolve();
    const now=Date.now();if(!force&&now-this.lastPersist<PERSIST_INTERVAL)return this.persistChain;this.lastPersist=now;
    const value = JSON.stringify({room:this.room,revision:this.revision,sequence:this.sequence,databaseRevision:this.databaseRevision});
    this.persistChain = this.persistChain.then(() => this.ctx.storage.put('room-state',JSON.parse(value)));
    return this.persistChain;
  }

  private async writeLobbyState() {
    if (!this.room || !this.env.DB) return;
    const result = await this.env.DB.prepare('UPDATE game_rooms SET state = ?, revision = revision + 1, updated_at = ? WHERE code = ? AND revision = ?')
      .bind(JSON.stringify(this.room),Date.now(),this.code,this.databaseRevision).run();
    if (!result.meta.changes) throw new Error('The room changed while returning to the lobby. Reconnect and try again.');
    this.databaseRevision++;
    this.revision=this.databaseRevision;
  }
}
