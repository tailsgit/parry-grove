import {test} from 'node:test';
import assert from 'node:assert/strict';
import {player,createGame,spawnEnemy,step,hitPlayer,xpRequired,generateRoom} from '../game/engine.js';
import {UPGRADES,ENEMIES} from '../game/config.js';
const setup=()=>{const p=player('a','Tester'),g=createGame([p],42);p.x=200;p.y=200;p.invuln=0;g.intro=0;g.obstacles=[];g.enemies=[];return {p,g};};
const upgrade=(p,id)=>UPGRADES.find(u=>u.id===id).apply(p);
test('upgrade values, percentage healing and caps match their descriptions',()=>{
 const p=player('a','Tester');p.hp=50;upgrade(p,'vitality');assert.equal(p.maxHp,125);assert.equal(p.hp,62.5);
 upgrade(p,'edge');assert.equal(p.damage,1.2);upgrade(p,'speed');assert.equal(p.speed,1.15);
 upgrade(p,'distance');assert.equal(p.dashPower,1.3);upgrade(p,'cleanse');assert.equal(p.cleanse,4);
 for(let n=0;n<20;n++){upgrade(p,'armor');upgrade(p,'dash');upgrade(p,'parry');}
 assert.equal(p.armor,.5);assert.equal(p.dashIframes,.3);assert.equal(p.perfect,.165);
});
test('kill experience scales as 2^level and levels grant HP, percent healing and damage',()=>{
 const {p,g}=setup();p.hp=50;p.damage=100;p.vampire=.01;
 for(let n=0;n<6;n++){g.enemies=[];spawnEnemy(g,'bow',230,200).nearPlayer=true;p.attackCd=0;step(g,{a:{attack:true,angle:0}},1/60);g.phase='combat';}
 assert.equal(p.kills,6);assert.equal(p.level,3);assert.equal(p.xp,0);assert.equal(p.maxHp,120);
 assert.ok(Math.abs(p.damage-100.1)<1e-6);assert.equal(xpRequired(p.level),8);
 assert.ok(Math.abs(p.hp-(50+2+16.5+4.4+18))<1e-6);
});
test('shield never refills with time or room transition; Perfection restores only to 50',()=>{
 const {p,g}=setup();spawnEnemy(g,'bow',700,400).cooldown=1000;p.shieldDamage=100;p.shieldBroken=true;
 for(let n=0;n<600;n++)step(g,{},1/60);assert.equal(p.shieldDamage,100);assert.equal(p.shieldBroken,true);
 generateRoom(g);assert.equal(p.shieldDamage,100);assert.equal(p.shieldBroken,true);
 upgrade(p,'perfection');p.invuln=0;p.parryLeft=.2;p.parryAge=0;
 for(let n=0;n<20;n++){p.invuln=0;assert.equal(hitPlayer(g,p,10,true,p.angle),'perfect');}
 assert.equal(p.shieldDamage,50);assert.equal(p.shieldBroken,false);
 p.shieldDamage=30;p.invuln=0;hitPlayer(g,p,10,true,p.angle);assert.equal(p.shieldDamage,30);
});
test('40% prediction uses deterministic seeded sampling and leads moving targets',()=>{
 const {p,g}=setup();p.hp=p.maxHp=100000;p.x=200;const e=spawnEnemy(g,'bow',650,200);e.nearPlayer=true;
 let predicted=0,total=0;
 for(let n=0;n<1000;n++){
  e.tell=.001;e.fireReadyAt=null;g.nextEnemyShot=0;p.y=200;
  step(g,{a:{my:1}},1/60);const b=g.bullets.at(-1);
  total++;if(b.predictive){predicted++;assert.ok(b.vy>0);}
  g.bullets=[];
 }
 assert.ok(predicted/total>.35&&predicted/total<.45);
});
test('railgun beam persists for one second, affects its whole line and is blockable',()=>{
 const {p,g}=setup();const e=spawnEnemy(g,'railgun',650,200);e.angle=Math.PI;e.tell=.001;e.cooldown=100;e.nearPlayer=true;
 step(g,{a:{guard:true,parry:1,angle:0}},1/60);const beam=g.hazards[0];assert.equal(beam.kind,'beam');assert.equal(beam.total,1);assert.equal(g.bullets.length,0);assert.equal(ENEMIES.railgun.tell,.35);
 assert.ok(p.shieldDamage>0);assert.equal(p.perfects,0);
 const first=p.hp;for(let n=0;n<20;n++)step(g,{a:{guard:true,angle:0}},1/60);assert.ok(p.hp<first);
 p.y=400;const safe=p.hp;for(let n=0;n<20;n++)step(g,{},1/60);assert.equal(p.hp,safe);
 for(let n=0;n<22;n++)step(g,{},1/60);assert.ok(!g.hazards.some(h=>h.kind==='beam'));
});
test('boss retreats less often, avoids corner dashes and launches animated mortar shells',()=>{
 const {p,g}=setup();p.x=650;p.y=400;const e=spawnEnemy(g,'boss',g.width-65,g.height-65);e.repositionCd=0;e.cooldown=100;e.slamCd=100;
 const x=e.x,y=e.y;step(g,{},1/60);assert.ok(e.repositionCd>3);assert.ok(e.repositionX<0||e.repositionY<0);
 for(let n=0;n<50;n++)step(g,{},1/60);assert.ok(e.x<x||e.y<y);assert.equal(e.repositionLeft,0);
 e.hp=e.maxHp*.4;e.tell=.001;e.repositionLeft=0;e.fireReadyAt=null;g.nextEnemyShot=0;
 step(g,{},1/60);const h=g.hazards.find(h=>h.sx!=null);assert.ok(h);assert.equal(h.sx,e.x);assert.equal(h.sy,e.y);
});
