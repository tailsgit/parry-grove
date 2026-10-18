import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {spawnEnemy,step,hitPlayer} from '../game/engine.js';
import {CombatFeedback} from '../game/combat-feedback.js';
process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';process.env.WRANGLER_SEND_METRICS='false';

test('two WebSocket clients receive the same contact/ownership cues while movement and timers keep advancing',async()=>{
 const bundle=await build({stdin:{contents:"import{POST}from'./app/api/room/route.ts';import{GET}from'./app/api/room/socket/route.ts';export{RoomRealtime}from'./game/room-realtime.ts';export default{fetch:r=>r.headers.get('Upgrade')?GET(r):POST(r)};",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],tsconfig:'tsconfig.json'});
 const mf=new Miniflare({cf:false,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],durableObjects:{ROOMS:'RoomRealtime'}});
 const sockets=[];
 try{
  const db=await mf.getD1Database('DB');await db.exec((await readFile('drizzle/0000_happy_kang.sql','utf8')).replaceAll('\n',' '));
  const post=async(body,session={})=>{const res=await mf.dispatchFetch('http://game.test/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...session})});assert.equal(res.status,200);return res.json();};
  const created=await post({action:'create',name:'Host'}),host={code:created.code,...created.session};
  const joined=await post({action:'join',code:host.code,name:'Guest'}),guest={code:host.code,...joined.session};
  await post({action:'ready'},host);await post({action:'ready'},guest);await post({action:'start'},host);
  const row=await db.prepare('SELECT state FROM game_rooms WHERE code = ?').bind(host.code).first(),room=JSON.parse(row.state),g=room.game,p=g.players[0];
  g.phase='combat';g.intro=0;g.enemies=[];g.obstacles=[];g.time=10;p.x=200;p.y=200;p.invuln=0;
  g.players[1].x=400;g.players[1].y=300;g.players[1].invuln=0;
  spawnEnemy(g,'bow',700,450).cooldown=100;
  const target=spawnEnemy(g,'bow',240,200);target.hp=1;target.cooldown=100;
  step(g,{[p.id]:{attack:true,angle:0}},1/60);
  p.invuln=0;p.parryLeft=.2;p.parryAge=0;hitPlayer(g,p,10,true,0);
  room.lastTick=Date.now();await db.prepare('UPDATE game_rooms SET state = ? WHERE code = ?').bind(JSON.stringify(room),host.code).run();
  async function client(session){
   const res=await mf.dispatchFetch(`http://game.test/api/room/socket?code=${host.code}`,{headers:{Upgrade:'websocket'}});assert.equal(res.status,101);
   const socket=res.webSocket;socket.accept();sockets.push(socket);const queue=[],waiters=[];
   socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){if(waiters.length)waiters.shift()(m);else queue.push(m);}});
   const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out waiting for authoritative snapshot')),5000);waiters.push(m=>{clearTimeout(timer);resolve(m);});});
   socket.send(JSON.stringify({type:'auth',id:session.id,token:session.token}));return {socket,next,initial:await next()};
  }
  const a=await client(host),b=await client(guest);
  for(const snapshot of [a.initial,b.initial]){
   const hit=snapshot.game.events.find(e=>e.weaponAction==='melee'),kill=snapshot.game.events.find(e=>e.kind==='kill');
   assert.equal(hit.fx.targetId,target.id);assert.ok(Number.isFinite(hit.fx.angle));assert.equal(kill.fx.amount,8);
   assert.ok(snapshot.game.players.find(q=>q.id===host.id).streakLeft>0);
  }
  const cursor=new CombatFeedback();for(const e of a.initial.game.events)cursor.accept(e,a.initial.game.time);
  assert.ok(b.initial.game.events.every(e=>!cursor.accept(e,b.initial.game.time)));
  const before=a.initial.game.time;
  a.socket.send(JSON.stringify({type:'input',input:{mx:1}}));b.socket.send(JSON.stringify({type:'input',input:{mx:-1}}));
  await new Promise(r=>setTimeout(r,70));
  a.socket.send(JSON.stringify({type:'input',input:{mx:1}}));
  let latest=await a.next();for(let n=0;n<5&&latest.game.time<=before+.03;n++)latest=await a.next();
  assert.ok(latest.game.time>before+.03);
  assert.ok(latest.game.players.find(q=>q.id===host.id).x>200);
  assert.ok(latest.game.players.find(q=>q.id===host.id).streakLeft<3);
 }finally{for(const socket of sockets)try{socket.close();}catch{}await mf.dispose();}
});
