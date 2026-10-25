// Real room Durable Objects/WebSockets with controlled projectile contacts.
// The loss percentages drop application messages; commands are retransmitted.
// This is distinct from the browser harness's ordered retransmission-stall model.
import {driver,sleep} from '../tests/helpers/room-driver.js';import {adminTeleport,spawnEnemy} from '../game/engine.js';import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const rows=[];
for(const profile of [{rtt:0,jitter:0,loss:0},{rtt:50,jitter:10,loss:0},{rtt:100,jitter:10,loss:0},{rtt:150,jitter:10,loss:0},{rtt:100,jitter:10,loss:1},{rtt:100,jitter:10,loss:2}]){
 const d=await driver();try{const[h,b]=await d.party(2),a=await d.socket(h,profile);await d.socket(b);await sleep(profile.rtt+80);const outcomes=[];
 for(let trial=0;trial<3;trial++){const f=await d.fixture(h.code),g=f.room.game;adminTeleport(g,1,1);g.time=0;g.spawnBudget=0;g.spawnWarnings=[];g.remainingSpawnGroups=0;g.enemies=[];spawnEnemy(g,'bow',800,450).cooldown=100;g.obstacles=[];g.intro=0;f.room.inputs={};for(const [i,p]of g.players.entries())Object.assign(p,{x:i?600:200,y:i?400:200,hp:100,maxHp:100,invuln:0,internal:12,parryLeft:0,parryCd:0,seenParry:0,seenDash:0,seenAttack:0,seenInteract:0,dashLeft:0,streak:3,streakLeft:3,perfects:0,regulars:0});g.bullets=[{id:999,kind:'pistol',x:271.9,y:200,vx:-180,vy:0,damage:20,radius:4,owner:'',life:4}];const seeded=await d.fixture(h.code,'seed',f.room);
 for(let n=0;n<150&&(a.latest.epoch!==seeded.epoch||a.latest.tick<15);n++)await sleep(5);const view=a.latest,seq=++a.seq,command={seq,input:{parry:1,guard:true,angle:0},viewSequence:view.sequence,viewTick:Math.max(0,view.tick-2)};let attempts=0;const send=()=>{attempts++;a.send({type:'input',commands:[command]});};send();const retry=setInterval(()=>{if(a.latest.ack<seq&&attempts<10)send();},33);await sleep(550+profile.rtt);clearInterval(retry);const after=await d.fixture(h.code),p=after.room.game.players.find(p=>p.id===h.id);assert.ok(Number.isFinite(p.hp));assert.ok(p.perfects<=1&&p.regulars<=1);assert.ok(after.room.game.bullets.filter(b=>b.owner===h.id).length<=1);outcomes.push({trial,viewTick:command.viewTick,issuedAtSnapshotTick:view.tick,perfect:p.perfects,regular:p.regulars,hp:p.hp,internal:p.internal,streak:p.streak,rewinds:after.metrics.rewinds,rejected:after.metrics.rejectedRewinds,attempts});
 }
 rows.push({...profile,clients:2,lossModel:'application-message drops with 33ms command retransmission',outcomes,droppedMessages:a.dropped});console.log(profile,outcomes.map(o=>({perfect:o.perfect,regular:o.regular,hp:o.hp,rewinds:o.rewinds})));
 }finally{await d.close();}
}
await mkdir('docs/multiplayer',{recursive:true});await writeFile('docs/multiplayer/parry-profiles.json',JSON.stringify(rows,null,2));
