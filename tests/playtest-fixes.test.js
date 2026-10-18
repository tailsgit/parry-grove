import test from 'node:test';
import assert from 'node:assert/strict';
import {player,createGame,hitPlayer,step,spawnEnemy,generateRoom} from '../game/engine.js';
import {KITS,createRun,claimKit,kitDetails,kitAccent} from '../game/run-content.js';
import {vitalityChange} from '../game/hud-feedback.js';
import {Renderer} from '../game/renderer.js';
import {ENEMIES,BALANCE,UPGRADES} from '../game/config.js';
import {roomState,member,applyAction} from '../game/rooms.js';
import {processFeedback} from '../game/renderer-feedback.js';
const sample=p=>({id:p.id,hp:p.hp,internal:p.internal,kitId:p.kitId,healthDamageTotal:p.healthDamageTotal});
function setup(){const p=player('solo','Test'),g=createGame([p],991);g.enemies=[];g.obstacles=[];g.intro=0;p.invuln=0;return {g,p};}
function context(){const gradient={addColorStop(){}};return new Proxy({createLinearGradient:()=>gradient,measureText:()=>({width:20})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});}
test('every encyclopedia sprite renders with full static context and minimal legacy context',()=>{
 for(const kind of Object.keys(ENEMIES)){const c=context(),r=new Renderer({getContext:()=>c});const e={id:kind,kind,x:0,y:0,angle:0,hp:ENEMIES[kind].hp,maxHp:ENEMIES[kind].hp};assert.doesNotThrow(()=>r.enemy(c,e),kind);assert.doesNotThrow(()=>Renderer.prototype.enemy.call({weapon:Renderer.prototype.weapon},c,e),kind);}
});
test('all kits describe real effects, preserve streak and suppress equipment damage feedback',()=>{
 for(const kit of KITS){const p=player('solo','Test'),g=createRun([p],1);g.kits=[{id:kit.id,x:p.x,y:p.y}];p.streak=2;p.streakLeft=3;const before=sample(p);claimKit(g,p.id,kit.id);assert.equal(p.maxHp,kit.health||100);assert.equal(p.shieldDamage,kit.shield||0);assert.equal(p.streak,2);assert.equal(vitalityChange(before,sample(p)).healthLoss,0);assert.ok(!g.events.some(e=>e.kind==='hurt'));assert.match(g.events.find(e=>e.kind==='kitpickup').text,/equipped · Max HP/);for(const id of kit.upgrades)assert.ok(kitDetails(kit).includes(UPGRADES.find(u=>u.id===id).desc));}
 assert.equal(new Set(KITS.map(k=>kitAccent(k.id))).size,KITS.length);
});
test('damage occurring in same snapshot as kit selection is still reported',()=>{const {g,p}=setup(),before=sample(p);p.kitId='hungry';p.maxHp=p.hp=80;hitPlayer(g,p,10,false);assert.equal(vitalityChange(before,sample(p)).healthLoss,10);assert.equal(p.streak,0);});
test('shield is block capacity: ordinary damage bypasses, block spends raw damage, rooms preserve',()=>{const {g,p}=setup();hitPlayer(g,p,10);assert.equal(p.shieldDamage,0);p.invuln=0;p.blocking=true;p.angle=0;hitPlayer(g,p,20,true,0);assert.equal(p.shieldDamage,20);assert.equal(p.hp,86);p.internal=15;generateRoom(g);assert.equal(p.shieldDamage,20);assert.equal(p.internal,15);p.shieldDamage=90;p.shieldRestore=5;p.invuln=0;p.parryLeft=.2;p.parryAge=0;hitPlayer(g,p,10);assert.equal(p.shieldDamage,85);});
test('developer actions deny by default and forged payload cannot grant permission',()=>{const m=member('host','sword',0),r=roomState(m,0);m.ready=true;applyAction(r,m,{action:'start'},0);assert.throws(()=>applyAction(r,m,{action:'admin',operation:'health',hp:999,allowAdmin:true},0),/disabled/);applyAction(r,m,{action:'admin',operation:'health',hp:999},0,{allowAdmin:true});assert.equal(r.game.players[0].hp,999);const guest=member('guest','sword',0);assert.throws(()=>applyAction(r,guest,{action:'admin',operation:'health',hp:999},0,{allowAdmin:true}),/host/);});
test('opt-in failed guard labels are viewer-local and throttled',()=>{const {g,p}=setup();g.practiceWorld=true;const c=context(),r=new Renderer({getContext:()=>c});for(let n=0;n<10;n++)processFeedback(r,{kind:'miss',id:n,x:p.x,y:p.y,who:p.id,text:'MISS'},g,p.id);assert.equal(r.labels.length,1);assert.equal(r.labels[0].text,'NO CONTACT');assert.ok(r.labels[0].y<p.y-25);});
test('death summary records actual lethal contact source and moment',()=>{const {g,p}=setup();g.time=42;g.room=3;g.stage=1;hitPlayer(g,p,150,true,0,{kind:'lancer'});assert.deepEqual(p.deathInfo,{time:42,room:4,area:2,cause:ENEMIES.lancer.name});});
test('boss intro suppresses attacks without changing configured timing',()=>{const {g,p}=setup();g.enemies=[];const boss=spawnEnemy(g,'boss',p.x+150,p.y);boss.cooldown=0;g.intro=1.5;for(let i=0;i<80;i++)step(g,{solo:{}},1/60);assert.equal(g.bullets.length,0);assert.equal(p.hp,100);assert.ok(g.intro>0);assert.equal(BALANCE.soloMeleeHitPause,.05);assert.equal(BALANCE.soloPerfectHitPause,.09);});
test('room traversal preserves internal and shield damage; next area clears both',async()=>{const {selectRoute}=await import('../game/run-content.js');const {g,p}=setup();g.runSystems=true;g.hostId=p.id;g.phase='route';g.routeOptions=['continue'];g.routeDoors=[{choice:'continue',x:p.x,y:p.y}];g.pendingRoom=1;p.internal=23;p.shieldDamage=60;selectRoute(g,p.id,'continue');assert.equal(p.internal,23);assert.equal(p.shieldDamage,60);g.phase='levelclear';p.seenInteract=0;step(g,{solo:{interact:1}},1/60);assert.equal(g.stage,1);assert.equal(p.internal,0);assert.equal(p.shieldDamage,0);assert.equal(p.shieldBroken,false);});
