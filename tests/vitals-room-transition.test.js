import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,step,chooseUpgrade} from '../game/engine.js';
import {createRun,beginRoute,openRouteDoors,selectRoute} from '../game/run-content.js';
import {vitalityChange} from '../game/hud-feedback.js';

test('ordinary legacy room transitions retain internal damage for every player',()=>{
  const p=player('p','Tester'),ally=player('ally','Friend'),g=createGame([p,ally],42);
  g.intro=0;g.enemies=[];p.internal=29;ally.internal=41;
  step(g,{},1/60);assert.equal(g.phase,'upgrade');
  for(const q of g.players)chooseUpgrade(g,q.id,q.offers.find(id=>id!=='hp'));
  step(g,{p:{interact:1}},1/60);
  assert.equal(g.room,1);assert.equal(g.phase,'combat');assert.equal(p.internal,29);assert.equal(ally.internal,41);
});
for(const choice of ['continue','shop','altar'])test(`physical ${choice} routes retain internal damage through the next room`,()=>{
  const p=player('p','Tester'),ally=player('ally','Friend'),g=createRun([p,ally],42);
  p.internal=29;ally.internal=41;
  beginRoute(g);g.routeOptions=[choice];openRouteDoors(g);
  const door=g.routeDoors[0];p.x=door.x;p.y=door.y;
  selectRoute(g,p.id,choice);
  assert.equal(p.internal,29);assert.equal(ally.internal,41);
  if(choice!=='continue'){
    p.x=g.exit.x;p.y=g.exit.y;
    step(g,{p:{interact:1,mx:choice==='shop'?1:0}},1/60);
  }
  assert.equal(g.phase,'combat');assert.equal(g.room,1);
  assert.equal(p.internal,29);assert.equal(ally.internal,41);
});
test('entering the next level clears internal damage and restores shield for the entire party',()=>{
  const p=player('p','Tester'),ally=player('ally','Friend'),g=createGame([p,ally],42);
  g.room=4;g.intro=0;g.enemies=[];
  p.internal=29;ally.internal=41;p.shieldDamage=70;ally.shieldDamage=100;ally.shieldBroken=true;
  step(g,{},1/60);assert.equal(g.phase,'levelclear');
  assert.equal(p.internal,29);assert.equal(ally.internal,41);
  step(g,{p:{interact:1}},1/60);
  assert.equal(g.stage,1);assert.equal(g.room,0);assert.equal(g.phase,'combat');
  for(const q of g.players){assert.equal(q.internal,0);assert.equal(q.shieldDamage,0);assert.equal(q.shieldBroken,false);}
});
test('HUD damage signals distinguish health loss and internal gain, including simultaneous chip damage',()=>{
  const before={id:'p',hp:100,internal:10};
  assert.deepEqual(vitalityChange(before,{id:'p',hp:90,internal:0}),{healthLoss:10,internalGain:0});
  assert.deepEqual(vitalityChange(before,{id:'p',hp:100,internal:25}),{healthLoss:0,internalGain:15});
  assert.deepEqual(vitalityChange(before,{id:'p',hp:98.4,internal:23}),{healthLoss:100-98.4,internalGain:13});
});
test('healing, cleansing, unchanged snapshots and switching players do not trigger damage animations',()=>{
  const before={id:'p',hp:80,internal:20};
  for(const after of [{id:'p',hp:100,internal:0},before,{id:'ally',hp:5,internal:90}]){
    assert.deepEqual(vitalityChange(before,after),{healthLoss:0,internalGain:0});
  }
});
