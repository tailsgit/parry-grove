import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,spawnEnemy,step,hasLineOfSight} from '../game/engine.js';
import {ENEMIES} from '../game/config.js';
import {frontShield} from '../game/level2.js';
const setup=()=>{const p=player('p','Tester','longsword'),g=createGame([p],42);g.stage=1;g.intro=0;g.enemies=[];g.obstacles=[];p.x=540;p.y=200;p.invuln=0;const e=spawnEnemy(g,'riot',500,200);e.cooldown=1000;e.nearPlayer=true;return {g,p,e};};
const tick=(g,n=1,input={})=>{for(let i=0;i<n;i++)step(g,{p:input},1/60);};
const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
test('a dash flank opens a real melee damage window while the front still blocks',()=>{
  const {g,p,e}=setup(),hp=e.hp;tick(g,1,{attack:true,angle:Math.PI});assert.equal(e.hp,hp);
  tick(g,7,{mx:-1,dash:1,angle:0});assert.ok(p.x<e.x);assert.equal(frontShield(e,p.x,p.y),false);
  assert.ok(Math.abs(e.angle)<ENEMIES.riot.turnSpeed*.16);
  p.attackCd=0;tick(g,1,{attack:true,angle:0});assert.ok(e.hp<hp);
});
test('a lone Riot Shield turns at most 67.5 degrees/sec and eventually faces the flank',()=>{
  const {g,p,e}=setup();p.x=400;let turn=0;
  for(let i=0;i<180;i++){const before=e.angle;tick(g);turn+=Math.abs(delta(e.angle,before));assert.ok(Math.abs(delta(e.angle,before))<=ENEMIES.riot.turnSpeed/60+1e-9);}
  assert.ok(turn>Math.PI-.01);assert.equal(frontShield(e,p.x,p.y),true);
});
test('escort repositioning cannot snap or double the shield turning rate',()=>{
  const {g,p,e}=setup();const ally=spawnEnemy(g,'sine',570,200);ally.stun=1000;p.x=400;
  tick(g);assert.equal(e.protectedAlly,ally.id);assert.ok(Math.abs(e.angle)<=ENEMIES.riot.turnSpeed/60+1e-9);assert.ok(e.angle!==Math.PI);
});
test('blocked line of sight also respects the turning limit and stun freezes facing',()=>{
  const {g,p,e}=setup();p.x=400;g.obstacles=[{x:445,y:100,w:10,h:200}];tick(g);assert.ok(Math.abs(e.angle)<=ENEMIES.riot.turnSpeed/60+1e-9);
  e.stun=1;const angle=e.angle;tick(g,10);assert.equal(e.angle,angle);
});
test('turning uses the shortest direction across the angle wrap and attack wind-up stays locked',()=>{
  const {g,p,e}=setup();e.angle=Math.PI-.01;p.x=400;p.y=199;
  tick(g);assert.ok(delta(e.angle,Math.PI-.01)>0);assert.ok(Math.abs(delta(e.angle,Math.PI-.01))<=ENEMIES.riot.turnSpeed/60+1e-9);
  e.tell=.3;e.action='attack';e.target=p.id;p.x=540;const angle=e.angle;tick(g,5);assert.equal(e.angle,angle);
});

test('a shield never obstructs its own line of sight while turning',()=>{const {g,p,e}=setup();p.x=400;assert.equal(hasLineOfSight(g,e,p),true);tick(g,1);assert.equal(hasLineOfSight(g,e,p),true);});
