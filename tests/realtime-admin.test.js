import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';process.env.WRANGLER_SEND_METRICS='false';
test('Cloudflare authoritative co-op persists host admin actions and rejects guests',async()=>{
 const bundle=await build({stdin:{contents:"import {POST} from './app/api/room/route.ts';export {RoomRealtime} from './game/room-realtime.ts';export default {fetch:POST};",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],tsconfig:'tsconfig.json'});
 const mf=new Miniflare({cf:false,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],durableObjects:{ROOMS:'RoomRealtime'}});
 try{
  const db=await mf.getD1Database('DB');await db.exec((await readFile('drizzle/0000_happy_kang.sql','utf8')).replaceAll('\n',' '));
  const post=async(body,session={})=>{const res=await mf.dispatchFetch('http://game.test/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...session})});return {status:res.status,data:await res.json()};};
  const created=await post({action:'create',name:'Host'}),code=created.data.code,host={code,...created.data.session};
  const joined=await post({action:'join',code,name:'Guest'}),guest={code,...joined.data.session};
  await post({action:'ready'},host);await post({action:'ready'},guest);assert.equal((await post({action:'start'},host)).status,200);
  assert.equal((await post({action:'admin',operation:'health',hp:999},guest)).status,400);
  const health=await post({action:'admin',operation:'health',hp:999},host);assert.equal(health.status,200);assert.equal(health.data.game.players.find(p=>p.id===host.id).hp,999);assert.equal(health.data.game.players.find(p=>p.id===guest.id).hp,100);
  const moved=await post({action:'admin',operation:'teleport',level:2,room:5},host);assert.equal(moved.status,200);assert.equal(moved.data.game.stage,1);assert.equal(moved.data.game.room,4);assert.deepEqual(moved.data.game.enemies.map(e=>e.kind),['twinBomber','twinRicochet']);
  const polled=await post({action:'poll'},guest);assert.equal(polled.data.game.stage,1);assert.equal(polled.data.game.room,4);assert.equal(polled.data.game.players.find(p=>p.id===host.id).hp,999);
  assert.equal((await post({action:'admin',operation:'teleport',level:99,room:5},host)).status,400);
  const unchanged=await post({action:'poll'},host);assert.equal(unchanged.data.game.stage,1);assert.equal(unchanged.data.game.room,4);
 }finally{await mf.dispose();}
});
