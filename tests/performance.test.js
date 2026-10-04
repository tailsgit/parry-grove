import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as engine from '../game/engine.js';
import {ObjectPool,SpatialGrid,RectangleBatch,compact} from '../game/performance.js';
import {stressGame,stressInput,canonical} from './performance-scenario.js';
const golden=JSON.parse(readFileSync(new URL('./fixtures/performance-parity.json',import.meta.url)));
for(const count of [12,32,180])test(`optimized simulation retains original tick states: ${count} enemies`,()=>{
  const g=stressGame(engine,count),inputs={p:{}};
  for(let tick=0;tick<1200;tick++){stressInput(tick,inputs.p);engine.step(g,inputs,1/60);if(golden[count][tick])assert.equal(createHash('sha256').update(JSON.stringify(canonical(g))).digest('hex'),golden[count][tick]);}
});
test('pool preserves every entity at capacity and reuses storage after expiry',()=>{
  const pool=new ObjectPool(()=>({}),4),active=[];let warmedCapacity;
  for(let run=0;run<100;run++){for(let i=0;i<36;i++){const value=pool.acquire();value.life=i%2;active.push(value);}compact(active,value=>value.life>0,pool);assert.equal(active.length,18);for(const value of active)pool.release(value);active.length=0;if(run===0)warmedCapacity=pool.created;else assert.equal(pool.created,warmedCapacity);}
  assert.ok(pool.created>=36);assert.equal(new Set(pool.free).size,pool.created);
});
test('spatial query never misses close peers or fast swept collision candidates and keeps source order',()=>{
  const grid=new SpatialGrid(64);grid.reset(1200,800);const points=[];
  for(let i=0;i<300;i++){const p={x:(i*73)%1200,y:(i*97)%800};points.push(p);grid.insert(i,p.x,p.y);}
  const reused=grid.result;
  for(const p of points){const candidates=grid.query(p.x-64,p.y-64,p.x+64,p.y+64);assert.equal(candidates,reused);assert.deepEqual(candidates,[...candidates].sort((a,b)=>a-b));for(let i=0;i<points.length;i++)if(Math.hypot(points[i].x-p.x,points[i].y-p.y)<64)assert.ok(candidates.includes(i));}
  const swept=grid.query(20-29,100-29,900+29,120+29);for(let i=0;i<points.length;i++)if(points[i].x>=20&&points[i].x<=900&&points[i].y>=100&&points[i].y<=120)assert.ok(swept.includes(i));
  grid.reset(900,570);assert.equal(grid.query(0,0,1200,800).length,0);
});
test('rectangle batch preserves native drawing order and skips only redundant color assignments',()=>{
  const batch=new RectangleBatch(1);batch.fillStyle='#123456';batch.fillRect(.25,1,2,3);batch.fillRect(4,5,6,7);batch.fillStyle='#abcdef';batch.fillRect(8,9,10,11);const commands=[];
  batch.replay({set fillStyle(color){commands.push(['color',color]);},fillRect(...args){commands.push(['rect',...args]);}});
  assert.deepEqual(commands,[['color','#123456'],['rect',.25,1,2,3],['rect',4,5,6,7],['color','#abcdef'],['rect',8,9,10,11]]);
});
