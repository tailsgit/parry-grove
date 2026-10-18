import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CombatFeedback} from '../game/combat-feedback.js';
import {FEEL,swingPose,effectScale} from '../game/feel-config.js';
import {FeedbackAudio,renderFeedbackSound} from '../game/feedback-audio.js';
import {Renderer} from '../game/renderer.js';
import {processFeedback} from '../game/renderer-feedback.js';
import {createGame,player,step,spawnEnemy,event} from '../game/engine.js';
import {BALANCE,WEAPONS} from '../game/config.js';

function setup(){const p=player('p','Tester'),g=createGame([p],42);g.intro=0;g.enemies=[];g.obstacles=[];p.x=200;p.y=200;p.invuln=0;return {g,p};}
const noop=()=>{};
function renderer(){
 const gradient={addColorStop:noop};let depth=0;
 const ctx=new Proxy({save(){depth++;},restore(){assert.ok(depth>0,'balanced Canvas save/restore');depth--;},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>o[k]??noop});
 const canvas={width:900,height:570,getContext:()=>ctx,getBoundingClientRect:()=>({width:900,height:570,left:0,top:0})};
 return {r:new Renderer(canvas),ctx,depth:()=>depth};
}
test('cosmetic events are consumed once across duplicate and stale snapshots',()=>{
 const f=new CombatFeedback(),e={id:1,time:0};assert.equal(f.accept(e,.1),true);assert.equal(f.accept(e,.2),false);
 assert.equal(f.accept({id:2,time:0},2),false);assert.equal(f.accept({id:1,time:2},2),false);
 f.reset();assert.equal(f.accept(e,0),true);
});
test('contact flashes, enemy reactions, ghosts and scrap flights have hard budgets',()=>{
 const {g,p}=setup(),f=new CombatFeedback();
 for(let n=0;n<200;n++){f.contact({x:0,y:0,fx:{targetId:n}},FEEL.melee);f.scrap({x:n,y:n,fx:{amount:8}});p.dashLeft=.1;f.advance(.04,g);}
 assert.ok(f.contacts.length<=FEEL.contacts);assert.ok(f.reactions.size<=FEEL.reactions);
 assert.ok(f.ghosts.length<=FEEL.afterimages);assert.ok(f.flights.length<=FEEL.flights);
 for(let n=0;n<40;n++)f.advance(.05,{players:[]});
 assert.equal(f.contacts.length,0);assert.equal(f.reactions.size,0);assert.equal(f.ghosts.length,0);assert.equal(f.ghostAt.size,0);assert.equal(f.flights.length,0);
});
test('mass scrap is aggregated cosmetically and does not postpone authoritative funds',()=>{
 const {g}=setup(),f=new CombatFeedback();g.scrap=800;
 for(let n=0;n<100;n++)f.scrap({x:n,y:n,fx:{amount:8}});
 assert.equal(f.flights.length,1);assert.equal(f.flights[0].amount,800);assert.equal(g.scrap,800);
 for(let n=0;n<12;n++)f.advance(.05,g);
 assert.equal(f.arrivals,1);assert.equal(f.flights.length,0);assert.equal(g.scrap,800);
});
test('reduced motion suppresses camera impulses and afterimages without touching the game',()=>{
 const {g,p}=setup(),f=new CombatFeedback();p.dashLeft=.1;
 const before=JSON.stringify(g);f.impulseAt(0,100);f.advance(.016,g,true);
 assert.deepEqual(f.cameraOffset(true),{x:0,y:0});assert.equal(f.ghosts.length,0);assert.equal(JSON.stringify(g),before);
 assert.ok(Math.abs(f.cameraOffset().x)<=FEEL.shake);
});
test('teammate and distant feedback is smaller than local feedback',()=>{
 const listener={id:'p',x:0,y:0};assert.equal(effectScale({who:'p',x:1000,y:1000},listener),1);
 assert.equal(effectScale({who:'ally',x:40,y:0},listener),FEEL.teammateScale);
 assert.equal(effectScale({who:'ally',x:900,y:0},listener),FEEL.distantScale);
});
test('swing anticipation, fast strike and recovery stay inside the existing animation clock',()=>{
 for(const weapon of Object.keys(WEAPONS)){
  const arc=WEAPONS[weapon].arc,at=t=>swingPose({weapon,arc,swing:.15*(1-t)});
  assert.ok(at(.1).offset<at(0).offset);assert.ok(at(.5).offset>at(.15).offset);
  assert.equal(at(1).offset,0);assert.equal(at(0).trail,false);
  assert.equal(at(.35).trail,true);assert.equal(at(1).trail,false);
  for(let n=12;n<=70;n++){const sample=at(n/100);if(sample.trail)assert.ok(Math.abs(sample.offset)<=arc/2);}
  const connected=swingPose({weapon,arc,swing:.15,connected:true});assert.equal(connected.trail,true);assert.ok(Math.abs(connected.offset)<arc*.05);
 }
});
test('melee metadata describes a real target-surface contact and pooled events clear it',()=>{
 const {g,p}=setup();const enemy=spawnEnemy(g,'bow',p.x+40,p.y);enemy.cooldown=100;
 step(g,{p:{attack:true,angle:0}},1/60);
 const hit=g.events.find(e=>e.weaponAction==='melee');assert.equal(hit.fx.targetId,enemy.id);
 assert.equal(hit.fx.x,p.x+22);assert.equal(hit.fx.y,p.y);
 assert.ok(Math.hypot(hit.fx.x-p.x,hit.fx.y-p.y)<=WEAPONS[p.weapon].range);
 for(let n=0;n<150;n++){const e=event(g,'swing',0,0);assert.equal(e.fx,undefined);assert.equal(e.itemId,undefined);}
});
test('reflection and dash-end metadata leave shared simulation timing and motion intact',()=>{
 const {g}=setup();spawnEnemy(g,'bow',700,400).cooldown=100;
 g.bullets=[{id:99,x:220,y:200,vx:-350,vy:0,damage:10,kind:'pistol',owner:'',life:2}];
 step(g,{p:{parry:1,angle:0}},1/60);
 const reflect=g.events.find(e=>e.kind==='reflect');assert.equal(reflect.fx.bulletId,99);
 assert.ok(Math.abs(Math.hypot(g.bullets[0].vx,g.bullets[0].vy)-350*BALANCE.deflectSpeed)<1e-6);
 const time=g.time;step(g,{p:{dash:1,mx:1}},1/60);for(let n=0;n<16;n++)step(g,{},1/60);
 assert.ok(Math.abs(g.time-time-17/60)<1e-8);assert.equal(g.events.filter(e=>e.kind==='dash').length,1);assert.equal(g.events.filter(e=>e.kind==='dashend').length,1);
});
test('full rendering is read-only, bounded, and does not replay confirmed effects',()=>{
 const original=globalThis.window;globalThis.window={devicePixelRatio:1};
 try{
  const {g,p}=setup(),{r,depth}=renderer();spawnEnemy(g,'bow',250,200).cooldown=100;
  for(let n=0;n<70;n++)event(g,n%2?'perfect':'explosion',p.x,p.y,'',p.id).radius=65;
  const before=JSON.stringify(g);r.draw(g,p.id,.016);const serial=r.feedback.lastEvent,first=r.particles.length;
  r.draw(g,p.id,0);assert.equal(r.feedback.lastEvent,serial);assert.equal(r.particles.length,first);
  assert.ok(first<=FEEL.particles);assert.ok(r.rings.length<=FEEL.rings);assert.equal(JSON.stringify(g),before);assert.equal(depth(),0);
 }finally{globalThis.window=original;}
});
test('reflection flash maps stay bounded under a full four-player volley',()=>{
 const {g,p}=setup(),{r}=renderer();for(let n=0;n<200;n++)processFeedback(r,{kind:'reflect',id:n,x:0,y:0,who:p.id,fx:{bulletId:n}},g,p.id);
 assert.ok(r.feedback.reflections.size<=FEEL.reflections);
});
test('synthesized swing, hit, parries, movement and pickup voices are distinct, finite and short',()=>{
 const hashes=new Set();for(const kind of ['swing','hit','perfect','regular','dash','dashend','pickup','explosion']){
  const samples=renderFeedbackSound(kind,16000);assert.ok(samples.length<=8000);
  assert.ok(samples.every(n=>Number.isFinite(n)&&Math.abs(n)<=.5));hashes.add(createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex'));
 }assert.equal(hashes.size,8);
});
function audioContext(){
 const node=()=>({gain:{setValueAtTime:noop},connect:noop,disconnect:noop});
 return {currentTime:0,state:'running',sampleRate:8000,createGain:node,createBuffer:(_c,n)=>{const data=new Float32Array(n);return {getChannelData:()=>data};},createBufferSource:()=>({playbackRate:{value:1},connect:noop,disconnect:noop,start:noop,stop(){this.onended?.();}})};
}
test('audio caps overlapping voices, pickup pitch and repeat rates, and resets pickup pitch after a gap',()=>{
 const ctx=audioContext(),a=new FeedbackAudio(ctx,{});
 for(let n=0;n<40;n++){ctx.currentTime+=.04;a.play('hit');}assert.equal(a.voices.length,FEEL.voices);
 assert.equal(a.play('hit'),false);
 for(let n=0;n<15;n++){ctx.currentTime+=.15;a.play('pickup');}assert.equal(a.pickupChain,FEEL.pickupPitchCap);
 ctx.currentTime+=1;a.play('pickup');assert.equal(a.pickupChain,0);
 a.setMuted(true);ctx.currentTime+=1;assert.equal(a.play('perfect'),false);a.dispose();assert.equal(a.voices.length,0);
});
