import {test} from 'node:test';
import assert from 'node:assert/strict';
import {player,createGame,spawnEnemy,step,hitPlayer,event} from '../game/engine.js';
import {dashBlast,dartHit} from '../game/level2.js';
import {BALANCE} from '../game/config.js';

function setup(){
  const p=player('p','Tester'),g=createGame([p],42);
  g.intro=0;g.obstacles=[];g.enemies=[];p.x=200;p.y=200;p.invuln=0;
  spawnEnemy(g,'bow',700,450).cooldown=1000;
  p.streak=3;p.streakLeft=BALANCE.streakTimeout;
  return {g,p};
}
test('missed parries preserve streak until its original three-second timer expires',()=>{
  const {g,p}=setup();
  step(g,{p:{parry:1}},1/60);
  for(let n=0;n<60;n++)step(g,{},1/60);
  assert.ok(g.events.some(e=>e.kind==='miss'));assert.equal(p.streak,3);
  assert.ok(p.streakLeft<2.1&&p.streakLeft>1.9);
  for(let n=0;n<122;n++)step(g,{},1/60);
  assert.equal(p.streak,0);assert.equal(p.streakLeft,0);
});
test('perfect parry grows the existing streak and refreshes the timer to three seconds',()=>{
  const {g,p}=setup();p.streakLeft=.1;p.parryLeft=.2;p.parryAge=0;
  assert.equal(hitPlayer(g,p,20,true,0),'perfect');
  assert.equal(p.streak,4);assert.equal(p.streakLeft,BALANCE.streakTimeout);
});
test('regular parry and block reset streak only if health actually drops',()=>{
  for(const kind of ['regular','block'])for(const damage of [0,20])for(const armor of [0,1]){
    const {g,p}=setup();p.armor=armor;
    if(kind==='regular'){p.parryLeft=.2;p.parryAge=p.perfect+.02;}else p.blocking=true;
    assert.equal(hitPlayer(g,p,damage,true,0),kind);
    assert.equal(p.streak,damage>0&&armor<1?0:3);
    assert.equal(p.streakLeft,BALANCE.streakTimeout);
  }
});
test('ordinary hits and stored damage reset streak on actual health loss',()=>{
  for(const [damage,internal,armor,expected] of [[0,0,0,3],[0,12,0,0],[20,0,0,0],[20,0,1,3]]){
    const {g,p}=setup();p.internal=internal;p.armor=armor;
    assert.equal(hitPlayer(g,p,damage,false,0),'hurt');assert.equal(p.streak,expected);
  }
});
test('invulnerability and successful dash immunity preserve streak',()=>{
  for(const kind of ['invuln','dash']){
    const {g,p}=setup();
    if(kind==='invuln')p.invuln=.2;else{p.dashLeft=.1;p.dashAge=.01;}
    assert.equal(hitPlayer(g,p,20,false),'immune');assert.equal(p.streak,3);
  }
});
test('dash-only explosions use the same actual-damage rule',()=>{
  for(const [damage,internal,expected] of [[0,0,3],[0,10,0],[20,0,0]]){
    const {g,p}=setup();p.internal=internal;
    assert.equal(dashBlast(g,p,damage,{event}),'hurt');assert.equal(p.streak,expected);
  }
  const {g,p}=setup();p.dashLeft=.1;p.dashAge=.01;
  assert.equal(dashBlast(g,p,20,{event}),'immune');assert.equal(p.streak,3);
});
test('zero-damage magnet darts preserve streak on regular parry and attachment',()=>{
  const b={vx:-350,vy:0};
  const {g,p}=setup();p.parryLeft=.2;p.parryAge=p.perfect+.02;
  assert.equal(dartHit(g,b,p,{hitPlayer,event}),'regular');assert.equal(p.streak,3);
  p.invuln=0;p.parryLeft=0;
  assert.equal(dartHit(g,b,p,{hitPlayer,event}),'attached');assert.equal(p.streak,3);
});
test('co-op players retain independent streaks and timers',()=>{
  const {g,p}=setup(),ally=player('ally','Friend');
  ally.x=400;ally.y=200;ally.streak=2;ally.streakLeft=3;g.players.push(ally);
  hitPlayer(g,p,10,false);assert.equal(p.streak,0);assert.equal(ally.streak,2);
  step(g,{},1/60);assert.equal(ally.streak,2);assert.ok(ally.streakLeft<3);
});
