import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,spawnEnemy,step,distance} from '../game/engine.js';
import {BALANCE as B,ENEMIES} from '../game/config.js';
const setup=()=>{const p=player('a','Tester'),g=createGame([p],42);p.x=200;p.y=200;p.invuln=0;g.intro=0;g.obstacles=[];g.enemies=[];return {p,g};};
test('internal damage remains unchanged over time and each base melee hit clears exactly 2',()=>{
 const {p,g}=setup();spawnEnemy(g,'bow',700,400).cooldown=1000;p.internal=20;
 for(let n=0;n<600;n++)step(g,{},1/60);assert.equal(p.internal,20);
 const target=spawnEnemy(g,'bow',p.x+30,p.y);target.nearPlayer=true;target.cooldown=1000;
 step(g,{a:{attack:true,angle:0}},1/60);assert.equal(p.internal,18);
});
test('shorter melee wind-ups and longer ranges connect on the first stationary-target strike',()=>{
 for(const [kind,gap,maxTell] of [['brawler',85,.3],['lancer',120,.4]]){
  const {p,g}=setup(),e=spawnEnemy(g,kind,p.x+gap,p.y);e.cooldown=0;e.nearPlayer=true;
  assert.equal(ENEMIES[kind].tell,maxTell);
  for(let n=0;n<50&&p.hp===100;n++)step(g,{},1/60);
  assert.ok(p.hp<100,kind);assert.ok(e.swing>0,kind);
 }
});
test('railgun thickness is tripled and its collision radius matches the wider shot',()=>{
 assert.equal(ENEMIES.railgun.projectileRadius,9);
 const {p,g}=setup();spawnEnemy(g,'bow',700,400).cooldown=1000;
 g.bullets=[{id:99,x:230,y:221,vx:-850,vy:0,damage:25,kind:'railgun',radius:9,unparryable:true,owner:'',life:2}];
 step(g,{},1/30);assert.equal(p.hp,75);
});
test('camping by the boss triggers a telegraphed unparryable shockwave and retreat',()=>{
 const {p,g}=setup(),e=spawnEnemy(g,'boss',260,200);e.cooldown=100;
 step(g,{a:{parry:1,guard:true,angle:0}},1/60);
 const h=g.hazards[0];assert.equal(e.action,'slam');assert.equal(e.danger,true);assert.equal(h.kind,'shockwave');assert.equal(h.r,B.bossSlamRadius);assert.equal(h.total,.85);
 const before=distance(p,e);
 for(let n=0;n<65;n++)step(g,{a:{parry:n+2,guard:true,angle:0}},1/60);
 assert.ok(p.hp<100);assert.equal(p.shieldDamage,20);assert.ok(distance(p,e)>before+30);
});
test('boss frequently repositions and mixes parryable and red projectile volleys',()=>{
 const {p,g}=setup(),e=spawnEnemy(g,'boss',650,200);p.hp=p.maxHp=100000;e.cooldown=0;e.repositionCd=100;
 const flags=[];let fired=0,moved=false;const x=e.x;
 for(let n=0;n<900;n++){
  const serial=g.serial;step(g,{},1/60);if(Math.abs(e.x-x)>50)moved=true;
  const events=g.events.filter(a=>a.kind==='fire'&&a.id>fired);
  for(const event of events){fired=event.id;const bullets=g.bullets.filter(b=>b.id>serial);if(bullets.length)flags.push(bullets[0].unparryable);}
 }
 assert.ok(moved);assert.ok(flags.includes(true));assert.ok(flags.includes(false));assert.ok(flags.length>=3);
});
