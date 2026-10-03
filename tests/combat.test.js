import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, player, step, hitPlayer, spawnEnemy, chooseUpgrade, generateRoom } from '../game/engine.js';
import { WEAPONS } from '../game/config.js';
const setup=()=>{const p=player('a','Tester'),g=createGame([p],42);p.invuln=0;g.intro=0;g.obstacles=[];return {p,g};};
test('perfect / regular / stored damage release',()=>{const {p,g}=setup();p.parryLeft=.2;p.parryAge=.02;assert.equal(hitPlayer(g,p,20,true,0),'perfect');assert.equal(p.hp,100);assert.equal(p.streak,1);p.invuln=0;p.parryAge=.15;assert.equal(hitPlayer(g,p,20,true,0),'regular');assert.equal(p.hp,98.4);assert.equal(p.internal,13);assert.equal(p.streak,0);p.invuln=0;p.parryLeft=0;assert.equal(hitPlayer(g,p,20,true,0),'hurt');assert.equal(p.hp,65.4);assert.equal(p.internal,0);});
test('facing, unparryable mortar, dash iframes',()=>{const {p,g}=setup();p.parryLeft=.2;p.parryAge=0;assert.equal(hitPlayer(g,p,10,true,Math.PI),'hurt');p.invuln=0;assert.equal(hitPlayer(g,p,10,false),'hurt');p.invuln=0;p.dashLeft=.1;p.dashAge=.05;assert.equal(hitPlayer(g,p,40,false),'immune');p.dashAge=.12;assert.equal(hitPlayer(g,p,10,false),'hurt');});
test('dagger hits one target and cleanses internal damage',()=>{const {p,g}=setup();p.weapon='dagger';p.internal=20;p.lastRegular=0;g.enemies=[];spawnEnemy(g,'bow',p.x+30,p.y);spawnEnemy(g,'bow',p.x+40,p.y);step(g,{a:{attack:true,angle:0}},1/60);assert.equal(p.internal,18);assert.equal(g.enemies.filter(e=>e.hp<e.maxHp).length,1);});
test('swept projectile collision, deflection, action deduplication',()=>{const {p,g}=setup();p.x=200;p.y=200;g.enemies=[];spawnEnemy(g,'bow',500,200);g.bullets=[{id:99,x:220,y:200,vx:-500,vy:0,damage:10,kind:'pistol',owner:'',life:2}];step(g,{a:{parry:1,angle:0}},1/60);assert.equal(g.bullets[0].owner,'a');assert.equal(p.hp,100);for(let n=0;n<40;n++)step(g,{a:{parry:1}},1/60);assert.ok(p.parryLeft<=0);assert.equal(p.seenParry,1);});
test('persistent internal damage, streak expiry and upgrade exactly once',()=>{const {p,g}=setup();p.internal=20;p.streak=2;p.streakLeft=.01;step(g,{},1/30);assert.equal(p.internal,20);assert.equal(p.streak,0);g.enemies=[];step(g,{},1/60);assert.equal(g.phase,'upgrade');const id=p.offers[0];assert.equal(chooseUpgrade(g,'a',id),true);assert.equal(chooseUpgrade(g,'a',id),false);step(g,{a:{interact:1}},1/60);assert.equal(g.room,1);assert.equal(g.phase,'combat');});
test('weapon differences, party scaling, boss, victory, death and fresh restart',()=>{assert.ok(WEAPONS.dagger.parry<WEAPONS.sword.parry&&WEAPONS.sword.parry<WEAPONS.longsword.parry);const solo=createGame([player('a','A')],1),party=createGame([0,1,2,3].map(i=>player(''+i,'P')),1);assert.ok(party.width>solo.width);assert.ok(party.enemies.length>solo.enemies.length);const {p,g}=setup();for(let n=0;n<4;n++){g.enemies=[];step(g,{},1/60);chooseUpgrade(g,'a',p.offers[0]);step(g,{a:{interact:n+1}},1/60);}assert.equal(g.room,4);assert.ok(g.enemies.some(e=>e.kind==='boss'));g.enemies=[];step(g,{},1/60);assert.equal(g.phase,'victory');const fresh=createGame([player('a','A')],2);fresh.players[0].hp=0;step(fresh,{},1/60);assert.equal(fresh.phase,'death');assert.equal(createGame([player('a','A')],3).players[0].hp,100);});
test('5000 integrated ticks: enemies, movement, attacks, parry, dash remain finite',()=>{const {p,g}=setup();g.room=3;generateRoom(g);p.hp=100000;p.maxHp=100000;for(let n=0;n<5000;n++){step(g,{a:{mx:Math.sin(n/70),my:Math.cos(n/90),angle:n/100,attack:true,parry:Math.floor(n/30),dash:Math.floor(n/60)}},1/60);for(const a of [p,...g.enemies,...g.bullets])assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));}assert.ok(g.events.length<=70);});

// Regressions for the close-combat and defense changes.
import { BALANCE } from '../game/config.js';
import { mouseButton, guardButton, resetGuard } from '../game/input.js';
import { cleanInput } from '../game/rooms.js';
test('right-click release preserves held attack, including co-op input',()=>{
  const i={attack:false,guard:false,parry:0};
  mouseButton(i,0,true);mouseButton(i,2,true);mouseButton(i,2,true);
  assert.equal(i.parry,1);assert.equal(cleanInput(i).guard,true);
  mouseButton(i,2,false);assert.equal(i.attack,true);assert.equal(i.guard,false);
  mouseButton(i,0,false);assert.equal(i.attack,false);
  assert.equal(cleanInput({guard:'true'}).guard,false);
});
test('point-blank melee hits touching bodies for every weapon; distant rear targets remain safe',()=>{
  for(const weapon of Object.keys(WEAPONS))for(const offset of [[0,0],[-10,0],[0,24]]){
    const {p,g}=setup();p.weapon=weapon;g.enemies=[];
    const e=spawnEnemy(g,'bow',p.x+offset[0],p.y+offset[1]);
    step(g,{a:{attack:true,angle:0}},1/60);assert.ok(e.hp<e.maxHp,weapon);
  }
  const {p,g}=setup();g.enemies=[];const e=spawnEnemy(g,'bow',p.x-65,p.y);
  step(g,{a:{attack:true,angle:0}},1/60);assert.equal(e.hp,e.maxHp);
});
test('all weapons have a 0.5s cooldown with a real gap and cannot restart by spamming',()=>{
  for(const weapon of Object.keys(WEAPONS)){
    const {p,g}=setup();p.weapon=weapon;
    step(g,{a:{parry:1}},1/60);assert.equal(p.parryCd,.5);
    for(let n=2;n<=28;n++)step(g,{a:{parry:n}},1/60);
    assert.ok(p.parryLeft<=0);assert.ok(p.parryCd>0);
    for(let n=0;n<4;n++)step(g,{a:{parry:28}},1/60);
    step(g,{a:{parry:29}},1/60);assert.equal(p.parryAge,0);
  }
});
test('perfect reset permits immediate re-parry during an attack; regular does not reset',()=>{
  for(const weapon of Object.keys(WEAPONS)){
    const {p,g}=setup();p.weapon=weapon;
    step(g,{a:{parry:1,attack:true}},1/60);assert.ok(p.swing>0);
    assert.equal(hitPlayer(g,p,10,true,0),'perfect');assert.equal(p.parryCd,0);
    step(g,{a:{parry:2,attack:true}},1/60);assert.equal(p.parryAge,0);assert.ok(p.swing>0);
    p.invuln=0;p.parryAge=p.perfect+.02;
    assert.equal(hitPlayer(g,p,10,true,0),'regular');assert.equal(p.parryCd,.5);
  }
});
test('held RMB becomes directional chip-damage block; red attacks bypass both defenses',()=>{
  const {p,g}=setup();p.internal=15;p.lastRegular=g.time;
  step(g,{a:{parry:1,guard:true}},1/60);assert.equal(p.blocking,false);
  for(let n=0;n<18;n++)step(g,{a:{parry:1,guard:true}},1/60);
  assert.equal(p.blocking,true);assert.equal(hitPlayer(g,p,20,true,0),'block');
  assert.equal(p.hp,96);assert.equal(p.internal,15);
  p.invuln=0;assert.equal(hitPlayer(g,p,20,true,Math.PI),'hurt');
  p.invuln=0;p.parryLeft=.2;p.parryAge=0;
  assert.equal(hitPlayer(g,p,10,false,0),'hurt');
  p.invuln=0;p.dashLeft=.1;p.dashAge=.01;assert.equal(hitPlayer(g,p,10,false),'immune');
  step(g,{a:{guard:false}},1/60);assert.equal(p.blocking,false);
});
test('third gunner volley is telegraphed red and cannot be deflected',()=>{
  const {p,g}=setup();g.enemies=[];p.x=200;p.y=200;
  const e=spawnEnemy(g,'pistol',500,200);e.burst=2;e.cooldown=0;
  step(g,{},1/60);assert.equal(e.danger,true);assert.equal(e.tell,.8);
  for(let n=0;n<49;n++)step(g,{},1/60);
  assert.ok(g.bullets.some(b=>b.unparryable));
  g.bullets=[{id:99,x:p.x+20,y:p.y,vx:-350,vy:0,damage:10,kind:'pistol',owner:'',life:2,unparryable:true}];
  p.invuln=0;p.parryLeft=.2;p.parryAge=0;p.blocking=true;
  step(g,{a:{guard:true}},1/60);assert.equal(p.hp,90);assert.equal(g.bullets.length,0);
});

test('held Q blocks after its parry window; mixed releases preserve the other guard',()=>{
  const {p,g}=setup(),i={parry:0};
  guardButton(i,'keyboard',true);guardButton(i,'keyboard',true);
  assert.equal(i.parry,1);
  for(let n=0;n<20;n++)step(g,{a:cleanInput(i)},1/60);
  assert.equal(p.blocking,true);assert.equal(hitPlayer(g,p,20,true,0),'block');
  mouseButton(i,2,true);guardButton(i,'keyboard',false);assert.equal(i.guard,true);
  guardButton(i,'keyboard',true);mouseButton(i,2,false);assert.equal(i.guard,true);
  guardButton(i,'keyboard',false);assert.equal(i.guard,false);
  resetGuard(i);assert.equal(i.keyGuard,false);assert.equal(i.mouseGuard,false);
});
function returnedShot(kind='pistol',enemyOffset=50) {
  const {p,g}=setup();p.x=200;p.y=200;g.enemies=[];
  const e=spawnEnemy(g,'bow',500,200+enemyOffset);e.cooldown=100;
  g.bullets=[{id:99,x:220,y:200,vx:-350,vy:0,damage:10,kind,owner:'',life:2,target:p.id}];
  step(g,{a:{parry:1,angle:0}},1/60);
  return {p,g,e,b:g.bullets[0]};
}
test('deflections accelerate and assist near aim without snapping to off-axis enemies',()=>{
  const {b}=returnedShot();assert.equal(b.owner,'a');
  assert.ok(Math.abs(Math.hypot(b.vx,b.vy)-350*BALANCE.deflectSpeed)<1e-6);
  assert.ok(b.vy>0);assert.ok(Math.atan2(b.vy,b.vx)<=BALANCE.deflectAssistTurn);
  const far=returnedShot('pistol',200);assert.equal(far.b.vy,0);
});
test('returned seekers home onto enemies and reacquire after their target dies',()=>{
  const {p,g,e,b}=returnedShot('homing');assert.equal(b.target,e.id);
  e.y=350;const initial=Math.atan2(b.vy,b.vx);step(g,{},1/60);
  assert.ok(Math.atan2(b.vy,b.vx)>initial);
  e.hp=0;const next=spawnEnemy(g,'bow',600,400);next.cooldown=100;
  step(g,{},1/60);assert.equal(b.target,next.id);assert.notEqual(b.target,p.id);
  next.hp=0;spawnEnemy(g,'bow',800,100).cooldown=100;
  // If no visible enemy remains, a returned seeker continues safely in a straight line.
  g.obstacles=[{x:400,y:0,w:30,h:570}];step(g,{},1/60);
  assert.ok(Number.isFinite(b.vx)&&Number.isFinite(b.vy));
});
test('simultaneously ready enemies fire fairly with at least 180ms between volleys',()=>{
  const {p,g}=setup();p.hp=p.maxHp=10000;g.enemies=[];
  const enemies=['bow','pistol','homing','shotgun','boss'].map((kind,i)=>spawnEnemy(g,kind,600,80+i*80));
  for(const e of enemies){e.tell=.01;e.cooldown=100;}
  const initialY=enemies.map(e=>e.y);
  const fires=[];let lastEvent=0;
  for(let n=0;n<120;n++){
    step(g,{},1/60);
    for(const event of g.events)if(event.id>lastEvent&&event.kind==='fire')fires.push(event);
    lastEvent=g.eventSerial;
  }
  assert.ok(fires.length>=enemies.length);
  for(let n=1;n<fires.length;n++)assert.ok(fires[n].time-fires[n-1].time>=BALANCE.enemyShotGap-1e-8);
  assert.deepEqual(fires.slice(0,enemies.length).map(f=>f.y),initialY);
});
