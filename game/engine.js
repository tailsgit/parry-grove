import { BALANCE as B, WEAPONS, ENEMIES, UPGRADES } from './config.js';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDiff = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
export function random(g) { g.seed = (Math.imul(g.seed,1664525)+1013904223)>>>0; return g.seed/4294967296; }
export function player(id, name, weapon = 'sword', slot = 0) {
  return { id, name, weapon, slot, x: 160, y: 260, angle: 0, hp: B.hp, maxHp: B.hp, internal: 0, level: 1, xp: 0,
    damage: 1, speed: 1, armor: 0, cleanse: B.meleeCleanse, perfect: B.perfectWindow,
    dashPower: 1, dashIframes: B.dashIframes, dashTime: B.dashTime,
    attackCd: 0, parryCd: 0, dashCd: 0, parryLeft: 0, parryAge: 0, parrySuccess: false, dashLeft: 0, dashAge: 0,
    dx: 0, dy: 0, invuln: 0, swing: 0, streak: 0, streakLeft: 0, lastRegular: -100,
    seenParry: 0, seenDash: 0, seenInteract: 0, upgrades: [], offers: [], chosen: false, kills: 0, perfects: 0, regulars: 0 };
}
export function createGame(players, seed = Date.now()>>>0) {
  const g = { seed, time: 0, room: 0, phase: 'combat', players, enemies: [], bullets: [], hazards: [], obstacles: [], events: [], serial: 0, eventSerial: 0, width: 900, height: 570, intro: 1.8, encounterParty: players.length };
  generateRoom(g); return g;
}
export function event(g, kind, x, y, text = '', who = '') {
  g.events.push({ id: ++g.eventSerial, kind, x, y, text, who, time: g.time });
  if(g.events.length>70) g.events.splice(0,g.events.length-70);
}
export function spawnEnemy(g, kind, x, y) {
  const c = ENEMIES[kind]; const scale = 1+g.room*.12 + (g.encounterParty-1)*(kind==='boss'?.48:.12);
  const e = {id:++g.serial,kind,x,y,hp:c.hp*scale,maxHp:c.hp*scale,angle:0,cooldown:1+random(g),tell:0,target:'',burst:0};
  g.enemies.push(e); return e;
}
export function generateRoom(g) {
  g.encounterParty = g.players.length; g.width = 900 + (g.encounterParty-1)*120; g.height = 570 + (g.encounterParty-1)*45;
  g.enemies=[]; g.bullets=[]; g.hazards=[]; g.obstacles=[]; g.intro=1.5;
  // Broad lanes and safe entrance keep random cover from creating unreachable enemies.
  const count = g.room===B.encounters?2:3+Math.floor(random(g)*3);
  for(let i=0;i<count;i++) {
    const o={x:300+random(g)*(g.width-470),y:85+random(g)*(g.height-210),w:40+Math.floor(random(g)*2)*24,h:40};
    if(g.obstacles.every(a=>Math.hypot(a.x-o.x,a.y-o.y)>110))g.obstacles.push(o);
  }
  g.players.forEach((p,i)=>{p.x=130;p.y=g.height/2+(i-(g.players.length-1)/2)*40;p.invuln=1.5;p.chosen=false;p.offers=[];p.dashLeft=0;p.parryLeft=0;p.swing=0;});
  if(g.room===B.encounters) {
    g.obstacles=g.obstacles.filter(o=>!inside({x:g.width-210,y:g.height/2},o,50));
    spawnEnemy(g,'boss',g.width-210,g.height/2);
    for(let i=1;i<g.encounterParty;i++)spawnEnemy(g,i%2?'bow':'mortar',g.width-140,100+i*90);
  } else {
    const kinds=['bow','pistol','homing','shotgun','mortar'];
    const n=B.baseEnemies+g.room+B.partyEnemies*(g.encounterParty-1);
    for(let i=0;i<n;i++) {
      let kind=kinds[(g.room+i)%Math.min(5,2+g.room+g.encounterParty-1)];
      if(g.room===3&&i===0)kind='mortar';
      let pos={x:380+random(g)*(g.width-440),y:70+random(g)*(g.height-140)};
      for(let k=0;k<20&&g.obstacles.some(o=>inside(pos,o,30));k++)pos={x:380+random(g)*(g.width-440),y:70+random(g)*(g.height-140)};
      spawnEnemy(g,kind,pos.x,pos.y);
    }
  }
}
function inside(p,o,r=0) {return p.x>o.x-r&&p.x<o.x+o.w+r&&p.y>o.y-r&&p.y<o.y+o.h+r;}
export function move(g,p,dx,dy,r=B.radius) {
  p.x=clamp(p.x+dx,30+r,g.width-30-r);
  for(const o of g.obstacles)if(inside(p,o,r))p.x=dx>0?o.x-r:o.x+o.w+r;
  p.y=clamp(p.y+dy,30+r,g.height-30-r);
  for(const o of g.obstacles)if(inside(p,o,r))p.y=dy>0?o.y-r:o.y+o.h+r;
}
function segmentDistance(p,a,b) {
  const vx=b.x-a.x,vy=b.y-a.y,t=clamp(((p.x-a.x)*vx+(p.y-a.y)*vy)/(vx*vx+vy*vy||1),0,1);
  return Math.hypot(p.x-a.x-t*vx,p.y-a.y-t*vy);
}
function blocked(g,a,b) {
  return g.obstacles.some(o=> {for(let t=0;t<=1;t+=.1)if(inside({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},o))return true;return false;});
}
export function hitPlayer(g,p,damage,parryable=true,sourceAngle=0) {
  if(p.hp<=0||p.invuln>0||(p.dashLeft>0&&p.dashAge<p.dashIframes))return 'immune';
  const facing=Math.abs(angleDiff(sourceAngle,p.angle))<B.parryCone;
  if(parryable&&p.parryLeft>0&&facing) {
    p.parrySuccess=true;
    // Brief successful-parry immunity prevents a single shotgun volley from cashing stored damage immediately.
    p.invuln=B.parryIframes;
    if(p.parryAge<=p.perfect) {
      p.streak+=p.weapon==='dagger'?2:1;p.streakLeft=B.streakTimeout;p.perfects++;
      if(p.weapon==='sword')p.internal=Math.max(0,p.internal-8);
      if(p.weapon==='longsword')for(const e of g.enemies)if(distance(e,p)<130)move(g,e,Math.cos(Math.atan2(e.y-p.y,e.x-p.x))*35,Math.sin(Math.atan2(e.y-p.y,e.x-p.x))*35,15);
      event(g,'perfect',p.x,p.y,`PERFECT ×${p.streak}`,p.id);return 'perfect';
    }
    p.hp=Math.max(0,p.hp-damage*B.regularChip*(1-p.armor));
    p.internal=clamp(p.internal+damage*B.regularStored*(1-p.armor),0,B.internalMax);
    p.lastRegular=g.time;p.streak=0;p.regulars++;
    event(g,'regular',p.x,p.y,'REGULAR',p.id);return 'regular';
  }
  const total=damage*(1-p.armor)+p.internal;p.hp=Math.max(0,p.hp-total);p.internal=0;p.streak=0;p.invuln=B.hurtIframes;
  event(g,'hurt',p.x,p.y,`−${Math.ceil(total)}`,p.id); if(!p.hp)event(g,'death',p.x,p.y,'DOWN',p.id);
  return 'hurt';
}
function kill(g,e,owner) {
  if(e.dead)return;e.dead=true;event(g,'kill',e.x,e.y,'',owner?.id);
  if(owner) {owner.kills++;owner.xp+=e.kind==='boss'?10:1;
    if(owner.xp>=4){owner.xp-=4;owner.level++;owner.maxHp+=5;owner.hp=Math.min(owner.maxHp,owner.hp+10);owner.damage+=.05;event(g,'level',owner.x,owner.y,`LEVEL ${owner.level}`,owner.id);}
  }
}
function melee(g,p) {
  const w=WEAPONS[p.weapon]; p.attackCd=w.cooldown;p.swing=.15;
  event(g,'swing',p.x,p.y,'',p.id);
  let n=0;
  for(const e of [...g.enemies].sort((a,b)=>distance(a,p)-distance(b,p))) {
    if(e.hp<=0||distance(e,p)>w.range+16||Math.abs(angleDiff(Math.atan2(e.y-p.y,e.x-p.x),p.angle))>w.arc/2||blocked(g,p,e))continue;
    const d=w.damage*p.damage*(1+p.streak*B.streakBonus);e.hp-=d;p.internal=Math.max(0,p.internal-p.cleanse);
    event(g,'hit',e.x,e.y,`${Math.round(d)}`,p.id);
    if(e.hp<=0)kill(g,e,p);
    if(++n>=w.targets)break;
  }
}
function fire(g,e,p) {
  const c=ENEMIES[e.kind],base=Math.atan2(p.y-e.y,p.x-e.x);e.angle=base;
  if(e.kind==='mortar') {g.hazards.push({id:++g.serial,x:p.x,y:p.y,r:60,remaining:1.2,total:1.2,damage:c.damage});event(g,'mortar',p.x,p.y);return;}
  const offsets=e.kind==='shotgun'?[-.3,-.15,0,.15,.3]:e.kind==='boss'?[-.5,-.25,0,.25,.5]:[0];
  for(const off of offsets) {const a=base+off;g.bullets.push({id:++g.serial,x:e.x+Math.cos(a)*24,y:e.y+Math.sin(a)*24,vx:Math.cos(a)*c.projectile,vy:Math.sin(a)*c.projectile,damage:c.damage*(1+g.room*.08),kind:e.kind,owner:'',life:7,target:p.id});}
  if(e.kind==='boss'&&e.hp<e.maxHp*.5) {
    for(let i=0;i<10;i++){const a=i*Math.PI/5+g.time;g.bullets.push({id:++g.serial,x:e.x,y:e.y,vx:Math.cos(a)*165,vy:Math.sin(a)*165,damage:10,kind:'bow',owner:'',life:7,target:p.id});}
    g.hazards.push({id:++g.serial,x:p.x,y:p.y,r:55,remaining:1.5,total:1.5,damage:20});
  }
  event(g,'fire',e.x,e.y);
}
export function chooseUpgrade(g,id,upgradeId) {
  const p=g.players.find(p=>p.id===id),u=UPGRADES.find(u=>u.id===upgradeId);
  if(g.phase!=='upgrade'||!p||p.hp<=0||p.chosen||!p.offers.includes(upgradeId)||!u)return false;
  u.apply(p);p.upgrades.push(upgradeId);p.chosen=true;event(g,'upgrade',p.x,p.y,u.name,p.id);return true;
}
export function step(g,inputs,dt) {
  dt=clamp(dt,0,1/30);g.time+=dt;
  if(g.phase!=='combat') {
    if(g.phase==='upgrade'&&g.players.filter(p=>p.hp>0).every(p=>p.chosen)) {
      const ready=g.players.some(p=>(inputs[p.id]?.interact||0)>p.seenInteract);
      if(ready) {g.players.forEach(p=>{p.seenInteract=inputs[p.id]?.interact||0;/* Decision: fallen co-op allies revive between rooms, never mid-fight. */if(p.hp<=0)p.hp=p.maxHp*.5;else p.hp=Math.min(p.maxHp,p.hp+8);p.internal=0;});g.room++;g.phase='combat';generateRoom(g);}
    }
    return;
  }
  g.intro=Math.max(0,g.intro-dt);
  for(const p of g.players) {
    for(const k of ['attackCd','parryCd','dashCd','invuln','swing','streakLeft'])p[k]=Math.max(0,p[k]-dt);
    if(!p.streakLeft)p.streak=0;if(g.time-p.lastRegular>B.internalDelay)p.internal=Math.max(0,p.internal-B.internalDecay*dt);
    if(p.parryLeft>0){p.parryLeft-=dt;p.parryAge+=dt;if(p.parryLeft<=0&&!p.parrySuccess){p.streak=0;event(g,'miss',p.x,p.y,'MISS',p.id);}}
    const i=inputs[p.id]||{}; if(p.hp<=0)continue;
    if(Number.isFinite(i.angle))p.angle=i.angle;
    let mx=clamp(i.mx||0,-1,1),my=clamp(i.my||0,-1,1),norm=Math.hypot(mx,my)||1;mx/=norm;my/=norm;
    if((i.dash||0)>p.seenDash) {p.seenDash=i.dash;if(!p.dashCd){p.dashCd=B.dashCooldown;p.dashLeft=p.dashTime;p.dashAge=0;p.dx=mx||my?mx:Math.cos(p.angle);p.dy=mx||my?my:Math.sin(p.angle);event(g,'dash',p.x,p.y,'',p.id);}}
    if((i.parry||0)>p.seenParry) {p.seenParry=i.parry;if(!p.parryCd){p.parryCd=B.parryCooldown;p.parryLeft=WEAPONS[p.weapon].parry;p.parryAge=0;p.parrySuccess=false;event(g,'guard',p.x,p.y,'',p.id);}}
    if(p.dashLeft>0){move(g,p,p.dx*B.dashSpeed*p.dashPower*dt,p.dy*B.dashSpeed*p.dashPower*dt);p.dashLeft-=dt;p.dashAge+=dt;}
    else move(g,p,mx*B.speed*p.speed*dt,my*B.speed*p.speed*dt);
    if(i.attack&&!p.attackCd)melee(g,p);
  }
  const alive=g.players.filter(p=>p.hp>0);
  if(!alive.length){g.phase='death';return;}
  for(const e of g.enemies) {
    if(e.hp<=0)continue;const c=ENEMIES[e.kind];const p=alive.reduce((a,b)=>distance(a,e)<distance(b,e)?a:b);
    e.angle=Math.atan2(p.y-e.y,p.x-e.x);
    if(g.intro>0)continue;
    if(e.tell>0){e.tell-=dt;if(e.tell<=0){fire(g,e,p);e.cooldown=c.rate/(1+g.room*.07);}continue;}
    e.cooldown-=dt;
    if(e.cooldown<=0){e.tell=c.tell;e.target=p.id;continue;}
    // Stay in ranged distance; a small orbit gives cover encounters moving targets.
    const d=distance(e,p),desired=e.kind==='boss'?250:e.kind==='shotgun'?145:210;
    const toward=d>desired?1:d<desired-60?-.65:0;
    move(g,e,(Math.cos(e.angle)*toward+Math.cos(e.angle+Math.PI/2)*.25)*c.speed*dt,(Math.sin(e.angle)*toward+Math.sin(e.angle+Math.PI/2)*.25)*c.speed*dt,e.kind==='boss'?25:15);
    for(const a of g.enemies)if(a.id!==e.id&&a.hp>0&&distance(a,e)<27){const an=Math.atan2(e.y-a.y,e.x-a.x);move(g,e,Math.cos(an)*30*dt,Math.sin(an)*30*dt,15);}
  }
  for(const b of g.bullets) {
    if(b.kind==='homing'&&!b.owner){const p=alive.find(p=>p.id===b.target)||alive[0];let a=Math.atan2(b.vy,b.vx);a+=clamp(angleDiff(Math.atan2(p.y-b.y,p.x-b.x),a),-dt*1.35,dt*1.35);const s=Math.hypot(b.vx,b.vy);b.vx=Math.cos(a)*s;b.vy=Math.sin(a)*s;}
    const prev={x:b.x,y:b.y};b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(b.x<25||b.x>g.width-25||b.y<25||b.y>g.height-25||g.obstacles.some(o=>inside(b,o,3))){b.life=0;continue;}
    if(b.owner) {
      for(const e of g.enemies)if(e.hp>0&&segmentDistance(e,prev,b)<(e.kind==='boss'?29:18)){const p=g.players.find(p=>p.id===b.owner);e.hp-=b.damage;event(g,'hit',e.x,e.y,`${Math.round(b.damage)}`,p?.id);if(e.hp<=0)kill(g,e,p);b.life=0;break;}
    } else for(const p of alive)if(segmentDistance(p,prev,b)<B.radius+5){
      const outcome=hitPlayer(g,p,b.damage,true,Math.atan2(-b.vy,-b.vx));
      if(outcome==='immune')continue;
      if(outcome==='perfect'||outcome==='regular') {
        // Aim deflections with the mouse instead of requiring exact incoming-angle reflection.
        const s=Math.hypot(b.vx,b.vy)*1.3;b.vx=Math.cos(p.angle)*s;b.vy=Math.sin(p.angle)*s;b.owner=p.id;b.damage*=outcome==='perfect'?2:1;b.life=4;b.x=p.x+Math.cos(p.angle)*24;b.y=p.y+Math.sin(p.angle)*24;
      }else b.life=0;
      break;
    }
  }
  for(const h of g.hazards) {h.remaining-=dt;if(h.remaining<=0&&!h.done){h.done=true;event(g,'explosion',h.x,h.y);for(const p of alive)if(distance(p,h)<h.r+B.radius)hitPlayer(g,p,h.damage,false);}}
  g.hazards=g.hazards.filter(h=>h.remaining>-.25);g.bullets=g.bullets.filter(b=>b.life>0);g.enemies=g.enemies.filter(e=>e.hp>0);
  if(!g.players.some(p=>p.hp>0)){g.phase='death';return;}
  if(!g.enemies.length) {
    g.bullets=[];g.hazards=[];
    if(g.room===B.encounters) {g.phase='victory';event(g,'victory',g.width/2,g.height/2);}
    else {g.phase='upgrade';for(const p of g.players){p.chosen=p.hp<=0;const pool=[...UPGRADES];p.offers=[];for(let n=0;n<3;n++){const j=Math.floor(random(g)*pool.length);p.offers.push(pool.splice(j,1)[0].id);}}event(g,'clear',g.width/2,g.height/2,'ROOM CLEARED');}
  }
}
