import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,spawnEnemy,step} from '../game/engine.js';
import {BALANCE} from '../game/config.js';
import {SoloHitPause} from '../game/hit-pause.js';

const tick=1/60,close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function setup(){
  const p=player('solo','Tester','longsword'),g=createGame([p],42);
  g.intro=0;g.obstacles=[];g.enemies=[];p.invuln=0;p.x=200;p.y=200;
  return {g,p,pause:new SoloHitPause()};
}
function target(g,p,kind='bow',offset=40){
  const e=spawnEnemy(g,kind,p.x+offset,p.y);e.cooldown=100;return e;
}
function shot(g,p){g.bullets=[{id:99,x:p.x+20,y:p.y,vx:-350,vy:0,damage:10,kind:'pistol',owner:'',life:2}];}
test('connected melee freezes simulation, movement, projectiles and timers, then resumes unused frame time',()=>{
  const {g,p,pause}=setup();target(g,p);shot(g,{x:500,y:350});
  pause.advance(g,{solo:{attack:true,angle:0}},tick,p.id);
  close(pause.remaining,BALANCE.soloMeleeHitPause);
  const frozen=JSON.stringify(g);
  close(pause.advance(g,{solo:{mx:1}},.03,p.id),0);
  assert.equal(JSON.stringify(g),frozen);
  const before=g.time;
  close(pause.advance(g,{solo:{mx:1}},.03,p.id),.01);
  close(g.time-before,.01);assert.ok(p.x>200);close(pause.remaining,0);
});
test('perfect parry pauses longer than melee; regular parry keeps advancing',()=>{
  for(const perfect of [true,false]){
    const {g,p,pause}=setup();target(g,p,'bow',300);shot(g,p);
    p.parryLeft=.2;p.parryAge=perfect?0:p.perfect+.02;
    pause.advance(g,{solo:{angle:0}},tick,p.id);
    assert.ok(g.events.some(e=>e.kind===(perfect?'perfect':'regular')));
    close(pause.remaining,perfect?BALANCE.soloPerfectHitPause:0);
    if(perfect){assert.ok(pause.remaining>BALANCE.soloMeleeHitPause);close(pause.advance(g,{},.05,p.id),0);}
    else close(pause.advance(g,{},.05,p.id),.05);
  }
});
test('multi-target melee does not stack pause; simultaneous perfect parry takes priority',()=>{
  const {g,p,pause}=setup();target(g,p);target(g,p,'bow',50);target(g,p,'bow',60);
  pause.advance(g,{solo:{attack:true,angle:0}},tick,p.id);
  assert.equal(g.events.filter(e=>e.weaponAction==='melee').length,3);
  close(pause.remaining,BALANCE.soloMeleeHitPause);
  const both=setup();target(both.g,both.p);shot(both.g,both.p);
  both.pause.advance(both.g,{solo:{attack:true,parry:1,angle:0}},tick,both.p.id);
  assert.ok(both.g.events.some(e=>e.kind==='perfect'));
  close(both.pause.remaining,BALANCE.soloPerfectHitPause);
});
test('misses, immune targets, enemy shield blocks and returned projectile hits do not pause',()=>{
  for(const kind of ['miss','suicide','riot','returned']){
    const {g,p,pause}=setup();const e=target(g,p,kind==='suicide'?'suicide':kind==='riot'?'riot':'bow',kind==='miss'?300:40);
    e.angle=Math.PI;
    if(kind==='returned')g.bullets=[{id:99,x:e.x-20,y:e.y,vx:350,vy:0,damage:10,kind:'pistol',owner:p.id,life:2}];
    pause.advance(g,{solo:{attack:kind!=='returned',angle:0}},tick,p.id);
    close(pause.remaining,0);
    if(kind==='returned'){assert.ok(g.events.some(e=>e.kind==='hit'));assert.ok(e.hp<e.maxHp);}
  }
});
test('reset clears pause and previous events never retrigger it',()=>{
  const {g,p,pause}=setup();target(g,p);
  pause.advance(g,{solo:{attack:true,angle:0}},tick,p.id);
  pause.reset();close(pause.advance(g,{},.05,p.id),.05);close(pause.remaining,0);
});
test('co-op shared engine advances every tick despite melee and perfect parry events',()=>{
  const {g,p}=setup();g.players.push(player('friend','Friend'));target(g,p);shot(g,p);
  step(g,{solo:{attack:true,parry:1,angle:0}},tick);
  assert.ok(g.events.some(e=>e.kind==='perfect'));
  assert.ok(g.events.some(e=>e.weaponAction==='melee'));
  const before=g.time;step(g,{},.05);close(g.time-before,1/30);
});
