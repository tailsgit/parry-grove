import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { step } from '../game/engine.js';

process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';
process.env.WRANGLER_SEND_METRICS='false';
// Exercise the real HTTP handler and D1 SQL, not a mocked lobby implementation.
test('HTTP + D1: four clients, CAS races, combat, rewards, disconnect, death and restart',async()=>{
 const bundle=await build({stdin:{contents:"import { POST } from './app/api/room/route.ts';export default {fetch:POST};",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],tsconfig:'tsconfig.json'});
 const mf=new Miniflare({cf:false,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']});
 try {
  const db=await mf.getD1Database('DB');await db.exec((await readFile('drizzle/0000_happy_kang.sql','utf8')).replaceAll('\n',' '));
  const post=async(body,session)=>{const res=await mf.dispatchFetch('http://game.test/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...session})});return {status:res.status,data:await res.json()};};
  const created=await post({action:'create',name:'Host',weapon:'sword'});assert.equal(created.status,200);assert.match(created.data.code,/^[A-Z2-9]{6}$/);
  const code=created.data.code,host={code,...created.data.session},sessions=[host];
  assert.equal((await post({action:'join',code:'ZZZZZZ',name:'Nobody'})).status,404);
  const guests=await Promise.all([1,2,3].map(i=>post({action:'join',code,name:'Guest '+i,weapon:i===1?'dagger':'longsword'})));
  for(const guest of guests){assert.equal(guest.status,200);sessions.push({code,...guest.data.session});}
  assert.equal((await post({action:'join',code,name:'Fifth'})).status,409);
  assert.equal((await post({action:'start'},host)).status,400);
  assert.equal((await post({action:'poll'},{...host,token:'forged'})).status,401);
  await Promise.all(sessions.map(s=>post({action:'ready'},s)));
  assert.equal((await post({action:'start'},sessions[1])).status,400);
  let start=await post({action:'start'},host);assert.equal(start.status,200);assert.equal(start.data.game.players.length,4);assert.equal(start.data.game.encounterParty,4);
  assert.equal(start.data.game.enemies.length,9);assert.equal((await post({action:'join',code,name:'Late'})).status,409);
  for(let n=0;n<15;n++){
   const results=await Promise.all(sessions.map((s,i)=>post({action:'input',input:{mx:i%2?1:0,my:i%2?0:1,angle:0,attack:true,parry:n+1,dash:n+1}},s)));
   for(const res of results){assert.equal(res.status,200);assert.equal(res.data.game.players.length,4);assert.ok(res.data.game.players.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.hp)));assert.ok(!JSON.stringify(res.data.members).includes('token'));}
  }
  const row=await db.prepare('SELECT state FROM game_rooms WHERE code = ?').bind(code).first();let r=JSON.parse(row.state);
  assert.ok(r.game.players.every(p=>p.seenParry>0));assert.ok(r.game.events.some(e=>e.kind==='dash'));assert.ok(r.game.events.some(e=>e.kind==='swing'));
  // Seed a room clear in the database, then use the actual per-player reward API.
  r.game.enemies=[];r.game.bullets=[];step(r.game,r.inputs,1/60);assert.equal(r.game.phase,'upgrade');
  await db.prepare('UPDATE game_rooms SET state = ? WHERE code = ?').bind(JSON.stringify(r),code).run();
  const picks=await Promise.all(sessions.map(s=>post({action:'upgrade',upgrade:r.game.players.find(p=>p.id===s.id).offers[0]},s)));for(const res of picks)assert.equal(res.status,200);
  assert.equal((await post({action:'upgrade',upgrade:r.game.players[0].offers[0]},host)).status,400);
  await post({action:'input',input:{interact:1}},host);await new Promise(resolve=>setTimeout(resolve,30));
  const next=await post({action:'poll'},host);assert.equal(next.data.game.room,1);assert.equal(next.data.game.phase,'combat');
  await post({action:'leave'},host);const transfer=await post({action:'poll'},sessions[1]);assert.equal(transfer.data.game.players.length,3);assert.notEqual(transfer.data.host,host.id);
  // Host timeout transfers ownership and keeps the same authoritative run.
  r=JSON.parse((await db.prepare('SELECT state FROM game_rooms WHERE code = ?').bind(code).first()).state);const timedOut=r.host;r.members.find(m=>m.id===timedOut).lastSeen=Date.now()-13000;
  const active=sessions.find(s=>s.id!==host.id&&s.id!==timedOut);await db.prepare('UPDATE game_rooms SET state = ? WHERE code = ?').bind(JSON.stringify(r),code).run();
  const afterTimeout=await post({action:'poll'},active);assert.equal(afterTimeout.data.game.players.length,2);assert.notEqual(afterTimeout.data.host,timedOut);
  r=JSON.parse((await db.prepare('SELECT state FROM game_rooms WHERE code = ?').bind(code).first()).state);r.game.players.forEach(p=>p.hp=0);step(r.game,r.inputs,1/60);
  await db.prepare('UPDATE game_rooms SET state = ? WHERE code = ?').bind(JSON.stringify(r),code).run();const survivor=sessions.find(s=>s.id===r.host);
  const dead=await post({action:'poll'},survivor);assert.equal(dead.data.game.phase,'death');
  const lobby=await post({action:'return'},survivor);assert.equal(lobby.data.game,null);assert.ok(lobby.data.members.every(m=>!m.ready));
  const liveSessions=sessions.filter(s=>lobby.data.members.some(m=>m.id===s.id));await Promise.all(liveSessions.map(s=>post({action:'ready'},s)));
  const restarted=await post({action:'start'},survivor);assert.equal(restarted.data.game.room,0);assert.ok(restarted.data.game.players.every(p=>p.hp===100&&p.internal===0&&p.upgrades.length===0));
  console.log('Verified: 4 concurrent clients; 60 input requests; reward barrier; host leave/timeout; fresh restart.');
 } finally {await mf.dispose();}
});
