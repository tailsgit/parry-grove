import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,player,spawnEnemy,step,hasLineOfSight,random,generateRoom} from '../game/engine.js';
import {Renderer} from '../game/renderer.js';
import {ENEMIES} from '../game/config.js';
const setup=()=>{const p=player('a','Tester'),g=createGame([p],42);p.x=200;p.y=200;p.invuln=0;p.hp=1e6;g.intro=0;g.obstacles=[];g.enemies=[];return {p,g};};
test('boss close shockwave deals 20 raw damage',()=>{const {p,g}=setup();const e=spawnEnemy(g,'boss',270,200);e.repositionCd=100;step(g,{},1/60);assert.equal(g.hazards[0].damage,20);for(let i=0;i<60;i++)step(g,{},1/60);assert.equal(p.hp,1e6-20);});
test('railgun wind-up aims at current position without consuming a prediction roll',()=>{
 for(let seed=1;seed<20;seed++){const {p,g}=setup();const e=spawnEnemy(g,'railgun',700,200);e.cooldown=0;g.seed=seed;step(g,{a:{my:1}},1/60);assert.equal(e.angle,Math.atan2(p.y-e.y,p.x-e.x));assert.equal(g.seed,seed);assert.equal(e.tell,ENEMIES.railgun.tell);}
});
test('exact line of sight catches thin cover and rejects walls between shooter and player',()=>{const {p,g}=setup();g.obstacles=[{x:337,y:190,w:2,h:20}];assert.equal(hasLineOfSight(g,{x:700,y:200},p),false);assert.equal(hasLineOfSight(g,{x:700,y:100},p),true);});
for(const kind of ['bow','pistol','homing','shotgun','mortar','railgun','boss'])test(`${kind} moves around blocked sight and does not fire behind cover`,()=>{
 const {p,g}=setup();g.obstacles=[{x:380,y:140,w:64,h:120}];const e=spawnEnemy(g,kind,500,200);e.cooldown=0;e.repositionCd=100;e.tell=.01;e.fireReadyAt=0;const startX=e.x,startY=e.y;
 for(let i=0;i<60;i++){assert.equal(hasLineOfSight(g,e,p),false);step(g,{},1/60);assert.equal(g.bullets.length,0);assert.equal(g.hazards.length,0);}
 assert.ok(Math.hypot(e.x-startX,e.y-startY)>10);assert.equal(e.fireReadyAt,null);assert.equal(e.tell,0);
 for(let i=0;i<1800&&!hasLineOfSight(g,e,p);i++)step(g,{},1/60);assert.equal(hasLineOfSight(g,e,p),true);
});
test('cover cancels a charging shot if sight is lost before firing',()=>{const {g}=setup(),e=spawnEnemy(g,'pistol',500,200);e.cooldown=0;step(g,{},1/60);assert.ok(e.tell>0);g.obstacles=[{x:380,y:140,w:64,h:120}];step(g,{},1/60);assert.equal(e.tell,0);assert.equal(g.bullets.length,0);});
test('room scenery remains identical while combat randomness advances',()=>{
 const {g}=setup(),theme={floor:['#1','#2','#3'],detail:'#4',border:'#5',edge:'#6',scenery:'flowers'};const record=()=>{const rectangles=[];Renderer.prototype.floor.call({theme},g,{set fillStyle(value){rectangles.push(value);},fillRect(...args){rectangles.push(args);}});return rectangles;};
 const before=record(),scenerySeed=g.scenerySeed;for(let i=0;i<50;i++)random(g);assert.equal(g.scenerySeed,scenerySeed);assert.deepEqual(record(),before);generateRoom(g);assert.equal(g.scenerySeed,scenerySeed);g.stage=1;generateRoom(g);assert.equal(g.scenerySeed,g.seed);
});
