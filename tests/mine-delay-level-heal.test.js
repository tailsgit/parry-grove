import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,spawnEnemy,step,chooseUpgrade} from '../game/engine.js';
const setup=()=>{const p=player('p','Tester'),g=createGame([p],42);g.stage=1;g.room=0;g.intro=0;g.enemies=[];g.obstacles=[];p.x=200;p.y=200;p.invuln=0;return {g,p};};
const tick=(g,n=1,input={})=>{for(let i=0;i<n;i++)step(g,{p:input},1/60);};
for(const kind of ['miner','twinBomber'])test(`${kind} mines allow an arming grace period and a slower triggered fuse`,()=>{
  const {g,p}=setup(),e=spawnEnemy(g,kind,200,200);
  if(kind==='miner'){e.mineTimer=0;e.mineState='approach';}
  else{e.tell=.001;e.target=p.id;e.action='attack';}
  tick(g);const mine=g.hazards.find(h=>h.kind==='mine');assert.ok(mine);assert.equal(mine.armed,false);assert.equal(mine.total,1);
  g.hazards=g.hazards.filter(h=>h===mine); // Isolate the mine from the boss’s simultaneous grenade.
  e.stun=1000;tick(g,40);assert.equal(mine.armed,false);assert.equal(p.hp,100);
  tick(g,21);assert.equal(mine.kind,'mineBlast');assert.ok(mine.remaining>.35);assert.equal(p.hp,100);
  tick(g,15);assert.equal(p.hp,100);tick(g,11);assert.ok(p.hp<100);
});
test('every player heals to their own maximum as soon as a level is cleared',()=>{
  const {g,p}=setup(),ally=player('ally','Friend');g.players.push(ally);g.stage=0;g.room=4;p.maxHp=145;p.hp=37;p.shieldDamage=80;p.internal=12;ally.maxHp=125;ally.hp=0;
  tick(g);assert.equal(g.phase,'levelclear');assert.equal(p.hp,145);assert.equal(ally.hp,125);assert.equal(p.shieldDamage,80);assert.equal(p.internal,12);
  p.hp=90;tick(g,20);assert.equal(p.hp,90); // The reward is a one-time clear event, not regeneration.
});
test('both twin bosses must fall before the final full heal',()=>{
  const {g,p}=setup();g.room=4;p.maxHp=125;p.hp=33;const a=spawnEnemy(g,'twinBomber',700,200),b=spawnEnemy(g,'twinRicochet',700,400);a.hp=0;b.stun=1000;
  tick(g);assert.equal(g.phase,'combat');assert.equal(p.hp,33);b.hp=0;tick(g);assert.equal(g.phase,'victory');assert.equal(p.hp,125);
});
test('ordinary room clears and advancement retain their existing small heal instead of full health',()=>{
  const {g,p}=setup();p.maxHp=145;p.hp=37;tick(g);assert.equal(g.phase,'upgrade');assert.equal(p.hp,37);
  assert.equal(chooseUpgrade(g,p.id,p.offers.find(id=>id!=='hp')),true);
  const hp=p.hp;tick(g,1,{interact:1});assert.equal(g.room,1);assert.equal(p.hp,hp+8);assert.ok(p.hp<p.maxHp);
});
