import { createGame, player, step, chooseUpgrade, adminTeleport, adminHealth, clamp } from './engine.js';
import { WEAPONS, BALANCE } from './config.js';
export function roomState(member, now) {return {host:member.id,members:[member],game:null,inputs:{},lastTick:now,createdAt:now};}
export function member(name,weapon,now) {return {id:crypto.randomUUID(),token:crypto.randomUUID(),name:String(name||'Adventurer').trim().slice(0,18)||'Adventurer',weapon:WEAPONS[weapon]?weapon:'sword',ready:false,lastSeen:now,slot:0};}
export function cleanInput(i={}) {return {mx:clamp(Number(i.mx)||0,-1,1),my:clamp(Number(i.my)||0,-1,1),angle:clamp(Number(i.angle)||0,-Math.PI*2,Math.PI*2),attack:i.attack===true,guard:i.guard===true,parry:clamp(Math.floor(Number(i.parry)||0),0,1e9),dash:clamp(Math.floor(Number(i.dash)||0),0,1e9),interact:clamp(Math.floor(Number(i.interact)||0),0,1e9)};}
export function advanceRoom(r,now) {
  const stale=r.members.filter(m=>now-m.lastSeen>BALANCE.disconnectSeconds*1000).map(m=>m.id);
  r.members=r.members.filter(m=>!stale.includes(m.id));for(const id of stale)delete r.inputs[id];
  if(!r.members.some(m=>m.id===r.host))r.host=r.members[0]?.id||'';
  if(r.game){r.game.players=r.game.players.filter(p=>!stale.includes(p.id));
    if(!r.game.players.length)r.game.phase='death';
    // Cap catch-up after tab suspension. The run resumes rather than instantly killing everyone.
    let remaining=Math.min(.25,Math.max(0,(now-r.lastTick)/1000));
    while(remaining>.0001){const dt=Math.min(1/60,remaining);step(r.game,r.inputs,dt);remaining-=dt;}
  }
  r.lastTick=now;
}
export function applyAction(r,m,payload,now) {
  const a=payload.action;
  if(a==='ready'){if(r.game)throw Error('The run has already begun.');m.ready=!m.ready;}
  if(a==='weapon'){if(r.game)throw Error('Choose your weapon in the lobby.');if(WEAPONS[payload.weapon])m.weapon=payload.weapon;}
  if(a==='start') {
    if(m.id!==r.host)throw Error('Only the host can start.');if(r.game)throw Error('Return to the lobby first.');
    if(!r.members.every(m=>m.ready))throw Error('Everyone must be ready.');
    r.inputs={};r.game=createGame(r.members.map(m=>player(m.id,m.name,m.weapon,m.slot)));r.lastTick=now;
  }
  if(a==='upgrade'&&!chooseUpgrade(r.game||{},m.id,payload.upgrade))throw Error('That upgrade is unavailable.');
  if(a==='return') {
    if(m.id!==r.host)throw Error('Only the host can return everyone to the lobby.');
    if(r.game&&!['victory','death'].includes(r.game.phase))throw Error('Finish the run first.');
    r.game=null;r.inputs={};r.members.forEach(m=>m.ready=false);
  }
  if(a==='admin'){
    if(m.id!==r.host)throw Error('Only the host can use admin controls.');
    if(!r.game)throw Error('Start a run before using admin controls.');
    if(payload.operation==='teleport'){
      adminTeleport(r.game,payload.level,payload.room);
      for(const p of r.game.players){const i=cleanInput(r.inputs[p.id]);r.inputs[p.id]={...i,mx:0,my:0,attack:false,guard:false};p.seenParry=i.parry;p.seenDash=i.dash;p.seenInteract=i.interact;}
    }else if(payload.operation==='health')adminHealth(r.game,m.id,payload.hp);
    else throw Error('Unknown admin action.');
  }
  if(a==='input')r.inputs[m.id]=cleanInput(payload.input);
  if(a==='leave') {
    r.members=r.members.filter(a=>a.id!==m.id);delete r.inputs[m.id];if(r.game)r.game.players=r.game.players.filter(p=>p.id!==m.id);
    if(r.host===m.id)r.host=r.members[0]?.id||'';
  }
}
export function publicRoom(code,r,revision) {return {code,host:r.host,members:r.members.map(m=>({id:m.id,name:m.name,weapon:m.weapon,ready:m.ready,slot:m.slot})),game:r.game,revision};}
