import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../game/renderer.js';
import {interactionFeedback} from '../game/interaction-feedback.js';
import {player,event} from '../game/engine.js';
import {createRun,claimKit,beginRoute,buyItem,selectRoute} from '../game/run-content.js';

test('interaction effects are brief and item-specific; combat keeps its existing effects',()=>{
 assert.equal(interactionFeedback({kind:'purchase',itemId:'heal'}).color,'#88ed9c');
 assert.equal(interactionFeedback({kind:'purchase',itemId:'repair'}).color,'#a6daff');
 assert.equal(interactionFeedback({kind:'shopdeny'}).shape,'cross');
 assert.equal(interactionFeedback({kind:'perfect'}),undefined);
});
test('pooled interaction rings reset when reused for combat and never change game state',()=>{
 const renderer=new Renderer({getContext:()=>({})}),g={time:2},before=JSON.stringify(g);
 renderer.addInteractionFeedback({kind:'sacrifice',x:1,y:2,who:'p'},g);
 assert.equal(renderer.rings[0].shape,'rune');assert.equal(renderer.particles.length,28);
 assert.equal(renderer.interactionPulses.get('p').until,2.75);assert.equal(JSON.stringify(g),before);
 renderer.ringPool.release(renderer.rings.pop());renderer.addRing({kind:'perfect',x:3,y:4});
 assert.equal(renderer.rings[0].shape,undefined);assert.equal(renderer.rings[0].color,undefined);assert.equal(renderer.rings[0].max,.28);
});
test('kit, door and purchase events report the actual completed interaction',()=>{
 const p=player('p','Tester'),g=createRun([p],42),kit=g.kits[0];p.x=kit.x;p.y=kit.y;claimKit(g,p.id,kit.id);
 assert.ok(g.events.some(e=>e.kind==='kitpickup'&&e.who===p.id));
 beginRoute(g);assert.equal(g.doorsOpenedAt,g.time);assert.equal(g.events.filter(e=>e.kind==='doorsopen').length,g.routeDoors.length);
 g.routeOptions=['shop'];g.routeDoors=[{choice:'shop',x:p.x,y:p.y,side:'bottom'}];selectRoute(g,p.id,'shop');
 const item=g.stock.find(i=>i.id==='repair');g.time=item.readyAt;p.x=item.x;p.y=item.y;p.shieldDamage=70;g.scrap=45;buyItem(g,p.id,item.id);
 const e=g.events.at(-1);assert.equal(e.kind,'purchase');assert.equal(e.itemId,'repair');assert.equal(p.shieldDamage,0);
 for(let i=0;i<100;i++)event(g,'swing',0,0);assert.ok(g.events.every(e=>e.itemId===undefined));
});
