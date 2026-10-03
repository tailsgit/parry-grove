import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,step,spawnEnemy,hitPlayer,distance,generateRoom} from '../game/engine.js';
import {BALANCE as B,ENEMIES} from '../game/config.js';
const setup=()=>{const p=player('a','Tester'),g=createGame([p],42);p.x=200;p.y=200;p.invuln=0;g.intro=0;g.obstacles=[];g.enemies=[];return {p,g};};
test('shield mitigates 80%, tracks raw damage before armor, breaks at 100 and never automatically recovers',()=>{
 const {p,g}=setup();spawnEnemy(g,'bow',700,450).cooldown=100;p.armor=.25;p.blocking=true;p.internal=10;p.lastRegular=g.time;
 for(let n=0;n<4;n++){assert.equal(hitPlayer(g,p,25,true,0),'block');assert.equal(p.shieldDamage,25*(n+1));}
 assert.equal(p.hp,85);assert.equal(p.internal,10);assert.equal(p.shieldBroken,true);assert.equal(p.blocking,false);
 assert.ok(g.events.some(e=>e.kind==='shieldbreak'));
 assert.equal(hitPlayer(g,p,10,true,0),'hurt');
 for(let n=0;n<170;n++)step(g,{a:{guard:true}},1/60);
 assert.equal(p.blocking,false);assert.equal(p.shieldBroken,true);
 for(let n=0;n<12;n++)step(g,{a:{guard:true}},1/60);
 assert.equal(p.shieldDamage,100);assert.equal(p.shieldBroken,true);assert.equal(p.blocking,false);
});
test('broken shields retain parrying; red attacks are blockable and rear attacks bypass guard',()=>{
 const {p,g}=setup();p.blocking=true;assert.equal(hitPlayer(g,p,10,false,0),'block');assert.equal(p.shieldDamage,10);
 p.invuln=0;hitPlayer(g,p,10,true,Math.PI);assert.equal(p.shieldDamage,10);
 p.invuln=0;p.shieldBroken=true;p.shieldRecovery=3;p.parryLeft=.2;p.parryAge=0;
 assert.equal(hitPlayer(g,p,10,true,0),'perfect');
});
test('melee parries stun the attacker and lock its movement and attacks',()=>{
 for(const age of [0,.15]){
  const {p,g}=setup(),e=spawnEnemy(g,'brawler',240,200);e.angle=Math.PI;e.tell=.001;e.target=p.id;e.nearPlayer=true;
  p.parryLeft=.25;p.parryAge=age;
  step(g,{},1/60);assert.equal(e.stun,B.enemyMeleeStun);assert.equal(p.hp,age===0?100:100-ENEMIES.brawler.damage*B.regularChip);
  const pos={x:e.x,y:e.y};for(let n=0;n<30;n++)step(g,{},1/60);
  assert.equal(e.x,pos.x);assert.equal(e.y,pos.y);assert.equal(e.tell,0);
 }
});
test('melee wind-up locks aim so stepping out of its arc avoids damage',()=>{
 const {p,g}=setup(),e=spawnEnemy(g,'lancer',240,200);e.angle=0;e.tell=.001;e.target=p.id;e.nearPlayer=true;
 step(g,{},1/60);assert.equal(p.hp,100);
});
test('local separation resolves exact overlap even while enemies wind up',()=>{
 const {g}=setup(),a=spawnEnemy(g,'bow',600,300),b=spawnEnemy(g,'bow',600,300);
 a.tell=b.tell=10;for(let n=0;n<60;n++)step(g,{},1/60);
 assert.ok(distance(a,b)>50);assert.ok(a.x<600&&b.x>600);
});
test('mortar leads actual player movement and keeps its target inside the arena',()=>{
 const {p,g}=setup(),e=spawnEnemy(g,'mortar',650,350);e.tell=.001;
 step(g,{a:{mx:1}},1/60);const h=g.hazards[0];assert.ok(h.x>p.x+100);assert.equal(h.y,p.y);assert.equal(h.sx,e.x);assert.equal(h.total,1.2);
 p.x=g.width-44;e.tell=.001;e.fireReadyAt=null;g.nextEnemyShot=0;
 step(g,{a:{mx:1}},1/60);assert.ok(g.hazards.at(-1).x<=g.width-45);
});
test('railgun has a red wind-up and fires an unparryable aimed shot',()=>{
 const {g}=setup(),e=spawnEnemy(g,'railgun',650,200);e.cooldown=0;
 step(g,{},1/60);assert.equal(e.danger,true);assert.equal(e.tell,.35);
 for(let n=0;n<61;n++)step(g,{},1/60);
 assert.ok(g.hazards.some(h=>h.kind==='beam'&&h.remaining>0));
});
test('nearby non-boss enemy parry uses its attack wind-up and stuns player for 0.5s',()=>{
 const {p,g}=setup(),e=spawnEnemy(g,'bow',235,200);g.seed=2000;e.cooldown=100;
 step(g,{},1/60);assert.equal(e.action,'parry');assert.equal(e.tell,ENEMIES.bow.tell);assert.equal(e.danger,false);
 for(let n=0;n<34;n++)step(g,{},1/60);assert.ok(e.guardLeft>0);
 step(g,{a:{attack:true,angle:0}},1/60);assert.equal(p.stun,.5);assert.equal(e.hp,e.maxHp);
 const x=p.x;for(let n=0;n<20;n++)step(g,{a:{mx:1,attack:true,parry:10,dash:10,guard:true}},1/60);
 assert.equal(p.x,x);assert.equal(p.blocking,false);assert.equal(p.parryLeft,0);
 for(let n=0;n<12;n++)step(g,{a:{mx:1}},1/60);assert.ok(p.x>x);
});
test('proximity parry is 10% per approach, not per frame, and excludes bosses',()=>{
 for(const kind of ['bow','boss']){const {g}=setup(),e=spawnEnemy(g,kind,235,200);g.seed=42;e.cooldown=100;
  for(let n=0;n<10;n++)step(g,{},1/60);assert.notEqual(e.action,'parry');
 }
 const {g}=setup();g.room=2;generateRoom(g);assert.ok(g.enemies.some(e=>ENEMIES[e.kind].melee));assert.ok(g.enemies.some(e=>e.kind==='railgun'));
});
