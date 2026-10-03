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
    dx: 0, dy: 0, invuln: 0, swing: 0, blocking: false, shieldDamage: 0, shieldBroken: false, vampire: 0, shieldRestore: 0, guardHeld: false, stun: 0, vx: 0, vy: 0, streak: 0, streakLeft: 0, lastRegular: -100,
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
  const e = {id:++g.serial,kind,x,y,hp:c.hp*scale,maxHp:c.hp*scale,angle:0,cooldown:1+random(g),tell:0,target:'',burst:0,danger:false,stun:0,guardLeft:0,guardAge:0,nearPlayer:false,parryAttemptCd:0,action:'attack',swing:0,repositionLeft:0,repositionCd:0,slamCd:0};
  g.enemies.push(e); return e;
}
export function generateRoom(g) {
  g.encounterParty = g.players.length; g.width = 900 + (g.encounterParty-1)*120; g.height = 570 + (g.encounterParty-1)*45;
  g.nextEnemyShot=g.time; g.enemies=[]; g.bullets=[]; g.hazards=[]; g.obstacles=[]; g.intro=1.5;
  // Broad lanes and safe entrance keep random cover from creating unreachable enemies.
  const count = g.room===B.encounters?2:3+Math.floor(random(g)*3);
  for(let i=0;i<count;i++) {
    const o={x:300+random(g)*(g.width-470),y:85+random(g)*(g.height-210),w:40+Math.floor(random(g)*2)*24,h:40};
    if(g.obstacles.every(a=>Math.hypot(a.x-o.x,a.y-o.y)>110))g.obstacles.push(o);
  }
  g.players.forEach((p,i)=>{p.x=130;p.y=g.height/2+(i-(g.players.length-1)/2)*40;p.invuln=1.5;p.chosen=false;p.offers=[];p.dashLeft=0;p.parryLeft=0;p.swing=0;p.blocking=false;p.guardHeld=false;p.stun=0;p.vx=0;p.vy=0;});
  if(g.room===B.encounters) {
    g.obstacles=g.obstacles.filter(o=>!inside({x:g.width-210,y:g.height/2},o,50));
    spawnEnemy(g,'boss',g.width-210,g.height/2);
    for(let i=1;i<g.encounterParty;i++)spawnEnemy(g,i%2?'bow':'mortar',g.width-140,100+i*90);
  } else {
    const kinds=['bow','pistol','homing','shotgun','mortar'];
    const n=B.baseEnemies+g.room+B.partyEnemies*(g.encounterParty-1);
    for(let i=0;i<n;i++) {
      let kind=i%2===0?(i%4===0?'brawler':'lancer'):kinds[(g.room+i)%Math.min(5,2+g.room+g.encounterParty-1)];
      if(g.room>=2&&i===1)kind='railgun';
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
export const xpRequired = level => 2 ** level;
export function hitPlayer(g,p,damage,parryable=true,sourceAngle=0) {
  if(p.hp<=0||p.invuln>0||(p.dashLeft>0&&p.dashAge<p.dashIframes))return 'immune';
  const facing=Math.abs(angleDiff(sourceAngle,p.angle))<B.parryCone;
  if(parryable&&p.parryLeft>0&&facing) {
    p.parrySuccess=true;
    // Brief successful-parry immunity prevents a single shotgun volley from cashing stored damage immediately.
    p.invuln=B.parryIframes;
    if(p.parryAge<=p.perfect) {
      p.parryCd=0;
      if(p.shieldRestore&&p.shieldDamage>50){p.shieldDamage=Math.max(50,p.shieldDamage-p.shieldRestore);p.shieldBroken=false;}
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
  if((p.blocking||(!parryable&&p.guardHeld))&&!p.shieldBroken&&facing) {
    const chip=damage*(1-p.armor)*(1-B.blockReduction);
    p.hp=Math.max(0,p.hp-chip);p.streak=0;
    p.shieldDamage=Math.min(B.shieldCapacity,(p.shieldDamage||0)+damage);
    if(p.shieldDamage>=B.shieldCapacity){p.shieldBroken=true;p.blocking=false;event(g,'shieldbreak',p.x,p.y,'SHIELD BROKEN',p.id);}
    event(g,'block',p.x,p.y,`BLOCK −${Math.ceil(chip)}`,p.id);
    if(!p.hp)event(g,'death',p.x,p.y,'DOWN',p.id);
    return 'block';
  }
  const total=damage*(1-p.armor)+p.internal;p.hp=Math.max(0,p.hp-total);p.internal=0;p.streak=0;p.invuln=B.hurtIframes;
  event(g,'hurt',p.x,p.y,`−${Math.ceil(total)}`,p.id); if(!p.hp)event(g,'death',p.x,p.y,'DOWN',p.id);
  return 'hurt';
}
function kill(g,e,owner) {
  if(e.dead)return;e.dead=true;event(g,'kill',e.x,e.y,'',owner?.id);
  if(owner) {owner.kills++;owner.xp++;
    if(owner.vampire)owner.hp=Math.min(owner.maxHp,owner.hp+owner.maxHp*owner.vampire);
    if(owner.xp>=xpRequired(owner.level)){owner.xp-=xpRequired(owner.level);owner.level++;owner.maxHp+=10;owner.hp=Math.min(owner.maxHp,owner.hp+owner.maxHp*.15);owner.damage+=.05;event(g,'level',owner.x,owner.y,`LEVEL ${owner.level}`,owner.id);}
  }
}
function melee(g,p) {
  const w=WEAPONS[p.weapon]; p.attackCd=w.cooldown;p.swing=.15;
  event(g,'swing',p.x,p.y,'',p.id);
  let n=0;
  for(const e of [...g.enemies].sort((a,b)=>distance(a,p)-distance(b,p))) {
    const gap=distance(e,p),radius=e.kind==='boss'?29:18;
    // Intersect the body with the swing sector; touching enemies cannot fall through its center.
    const bodyAngle=Math.asin(Math.min(1,radius/(gap||1)));
    if(e.hp<=0||gap>w.range+radius||(gap>B.radius+radius&&Math.abs(angleDiff(Math.atan2(e.y-p.y,e.x-p.x),p.angle))>w.arc/2+bodyAngle)||blocked(g,p,e))continue;
    if(e.guardLeft>0&&Math.abs(angleDiff(Math.atan2(p.y-e.y,p.x-e.x),e.angle))<B.parryCone){
      p.stun=B.playerParryStun;p.blocking=false;p.guardHeld=false;p.parryLeft=0;p.dashLeft=0;p.swing=0;
      e.guardLeft=0;event(g,'enemyparry',p.x,p.y,'PARRIED · STUNNED',p.id);break;
    }
    const d=w.damage*p.damage*(1+p.streak*B.streakBonus);e.hp-=d;p.internal=Math.max(0,p.internal-p.cleanse);
    event(g,'hit',e.x,e.y,`${Math.round(d)}`,p.id);
    if(e.hp<=0)kill(g,e,p);
    if(++n>=w.targets)break;
  }
}
function deflectionTarget(g,b,angle,cone=Math.PI) {
  return g.enemies.filter(e=>e.hp>0&&!blocked(g,b,e)&&Math.abs(angleDiff(Math.atan2(e.y-b.y,e.x-b.x),angle))<=cone)
    .sort((a,c)=>distance(a,b)-distance(c,b))[0];
}
function steer(b,target,turn) {
  const angle=Math.atan2(b.vy,b.vx),speed=Math.hypot(b.vx,b.vy);
  const adjusted=angle+clamp(angleDiff(Math.atan2(target.y-b.y,target.x-b.x),angle),-turn,turn);
  b.vx=Math.cos(adjusted)*speed;b.vy=Math.sin(adjusted)*speed;
}
function repositionBoss(g,e,p) {
  if(e.repositionCd>0)return;
  const toward=Math.atan2(p.y-e.y,p.x-e.x),d=distance(e,p);
  const preferred=d<180?toward+Math.PI:d>340?toward:toward+(e.burst%2?1:-1)*Math.PI/2;
  const angles=[preferred,toward,toward+Math.PI,toward+Math.PI/2,toward-Math.PI/2];
  const travel=B.bossRepositionSpeed*.35;
  const options=angles.map((a,i)=>{
    const end={x:e.x+Math.cos(a)*travel,y:e.y+Math.sin(a)*travel};
    const legal=end.x>65&&end.x<g.width-65&&end.y>65&&end.y<g.height-65&&!blocked(g,e,end)&&!g.obstacles.some(o=>inside(end,o,29));
    return {a,score:legal?(i===0?100:0)-Math.abs(distance(end,p)-250)*.1:-10000};
  }).sort((a,b)=>b.score-a.score);
  e.repositionCd=3.8;
  if(options[0].score<=-10000)return;
  e.repositionLeft=.35;e.repositionX=Math.cos(options[0].a);e.repositionY=Math.sin(options[0].a);
}
function predictedAim(g,e,p,speed) {
  const predictive=random(g)<.4,t=Math.min(1.2,distance(e,p)/speed);
  const x=p.x+clamp(p.vx||0,-B.speed*p.speed,B.speed*p.speed)*t;
  const y=p.y+clamp(p.vy||0,-B.speed*p.speed,B.speed*p.speed)*t;
  return {predictive,angle:predictive?Math.atan2(y-e.y,x-e.x):e.angle};
}
function beamEnd(g,e,angle) {
  let end={x:e.x,y:e.y};
  for(let length=24;length<Math.hypot(g.width,g.height);length+=4){
    const next={x:e.x+Math.cos(angle)*length,y:e.y+Math.sin(angle)*length};
    if(next.x<25||next.x>g.width-25||next.y<25||next.y>g.height-25||g.obstacles.some(o=>inside(next,o,9)))break;
    end=next;
  }
  return end;
}
function fire(g,e,p) {
  e.recoil=.24;
  const c=ENEMIES[e.kind],base=e.angle;
  if(c.melee){
    e.swing=.2;event(g,'meleeswing',e.x,e.y);
    if(distance(e,p)<=c.range+B.radius&&!blocked(g,e,p)&&Math.abs(angleDiff(Math.atan2(p.y-e.y,p.x-e.x),e.angle))<=c.arc/2){
      const result=hitPlayer(g,p,c.damage*(1+g.room*.08),true,Math.atan2(e.y-p.y,e.x-p.x));
      if(result==='perfect'||result==='regular'){e.stun=B.enemyMeleeStun;e.guardLeft=0;event(g,'enemystun',e.x,e.y,'STUNNED');}
    }
    return;
  }
  if(e.kind==='railgun') {const end=beamEnd(g,e,base);g.hazards.push({id:++g.serial,kind:'beam',x:e.x,y:e.y,ex:end.x,ey:end.y,r:9,remaining:1,total:1,damage:c.damage*.4,nextHits:{}});event(g,'beam',e.x,e.y);return;}
  if(e.kind==='mortar') {
    const vx=clamp(p.vx||0,-B.speed*p.speed,B.speed*p.speed),vy=clamp(p.vy||0,-B.speed*p.speed,B.speed*p.speed);
    const x=clamp(p.x+vx*.65,45,g.width-45),y=clamp(p.y+vy*.65,45,g.height-45);
    g.hazards.push({id:++g.serial,x,y,sx:e.x,sy:e.y,r:60,remaining:1.2,total:1.2,damage:c.damage});event(g,'mortar',e.x,e.y);return;
  }
  const offsets=e.kind==='shotgun'?[-.3,-.15,0,.15,.3]:e.kind==='boss'?[-.5,-.25,0,.25,.5]:[0];
  for(const off of offsets) {const aim=predictedAim(g,e,p,c.projectile),a=(aim.predictive?aim.angle:base)+off;g.bullets.push({id:++g.serial,x:e.x+Math.cos(a)*24,y:e.y+Math.sin(a)*24,vx:Math.cos(a)*c.projectile,vy:Math.sin(a)*c.projectile,damage:c.damage*(1+g.room*.08),kind:e.kind,predictive:aim.predictive,radius:c.projectileRadius||3,unparryable:e.danger,owner:'',life:7,target:p.id});}
  if(e.kind==='boss'&&e.hp<e.maxHp*.5) {
    for(let i=0;i<10;i++){const aim=predictedAim(g,e,p,165),a=aim.predictive?aim.angle:i*Math.PI/5+g.time;g.bullets.push({id:++g.serial,x:e.x,y:e.y,vx:Math.cos(a)*165,vy:Math.sin(a)*165,damage:10,kind:'bow',predictive:aim.predictive,unparryable:e.danger,owner:'',life:7,target:p.id});}
    g.hazards.push({id:++g.serial,x:p.x,y:p.y,sx:e.x,sy:e.y,r:55,remaining:1.5,total:1.5,damage:20});
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
    for(const k of ['attackCd','parryCd','dashCd','invuln','swing','streakLeft','stun'])p[k]=Math.max(0,(p[k]||0)-dt);
    if(!p.streakLeft)p.streak=0;
    if(p.parryLeft>0){p.parryLeft-=dt;p.parryAge+=dt;if(p.parryLeft<=0&&!p.parrySuccess){p.streak=0;event(g,'miss',p.x,p.y,'MISS',p.id);}}
    const i=inputs[p.id]||{}; if(p.hp<=0)continue;
    if(Number.isFinite(i.angle))p.angle=i.angle;
    if(p.stun>0){p.blocking=false;p.guardHeld=false;p.vx=0;p.vy=0;p.seenParry=i.parry||0;p.seenDash=i.dash||0;continue;}
    const previous={x:p.x,y:p.y};
    let mx=clamp(i.mx||0,-1,1),my=clamp(i.my||0,-1,1),norm=Math.hypot(mx,my)||1;mx/=norm;my/=norm;
    if((i.dash||0)>p.seenDash) {p.seenDash=i.dash;if(!p.dashCd){p.dashCd=B.dashCooldown;p.dashLeft=p.dashTime;p.dashAge=0;p.dx=mx||my?mx:Math.cos(p.angle);p.dy=mx||my?my:Math.sin(p.angle);event(g,'dash',p.x,p.y,'',p.id);}}
    if((i.parry||0)>p.seenParry) {p.seenParry=i.parry;if(!p.parryCd){p.parryCd=B.parryCooldown;p.parryLeft=WEAPONS[p.weapon].parry;p.parryAge=0;p.parrySuccess=false;event(g,'guard',p.x,p.y,'',p.id);}}
    if(p.dashLeft>0){move(g,p,p.dx*B.dashSpeed*p.dashPower*dt,p.dy*B.dashSpeed*p.dashPower*dt);p.dashLeft-=dt;p.dashAge+=dt;}
    else move(g,p,mx*B.speed*p.speed*(i.guard&&!p.shieldBroken&&p.parryLeft<=0?B.blockSpeed:1)*dt,my*B.speed*p.speed*(i.guard&&!p.shieldBroken&&p.parryLeft<=0?B.blockSpeed:1)*dt);
    p.guardHeld=i.guard===true&&p.dashLeft<=0;
    p.blocking=i.guard===true&&!p.shieldBroken&&p.parryLeft<=0&&p.dashLeft<=0;
    p.vx=dt?(p.x-previous.x)/dt:0;p.vy=dt?(p.y-previous.y)/dt:0;
    if(i.attack&&!p.attackCd)melee(g,p);
  }
  const alive=g.players.filter(p=>p.hp>0);
  if(!alive.length){g.phase='death';return;}
  // Evaluate separation against a shared snapshot so peers push apart symmetrically.
  const peers=g.enemies.filter(e=>e.hp>0).map(e=>({id:e.id,x:e.x,y:e.y}));
  for(const e of g.enemies) {
    if(e.hp<=0)continue;
    for(const key of ['stun','guardLeft','parryAttemptCd','swing','recoil','repositionLeft','repositionCd','slamCd'])e[key]=Math.max(0,(e[key]||0)-dt);
    if(e.stun>0)continue;
    const c=ENEMIES[e.kind],p=alive.reduce((a,b)=>distance(a,e)<distance(b,e)?a:b),d=distance(e,p);
    let vx=0,vy=0;
    if(g.intro<=0){
      if(e.kind==='boss'&&e.repositionLeft>0){
        vx=e.repositionX*B.bossRepositionSpeed;vy=e.repositionY*B.bossRepositionSpeed;
      }else if(e.tell<=0&&e.fireReadyAt==null&&e.guardLeft<=0){
        e.angle=Math.atan2(p.y-e.y,p.x-e.x);
        const near=d<B.enemyParryRange;
        if(e.kind!=='boss'&&near&&!e.nearPlayer&&!e.parryAttemptCd){
          e.parryAttemptCd=2;
          if(random(g)<B.enemyParryChance){e.action='parry';e.danger=false;e.tell=c.tell;e.target=p.id;}
        }
        e.nearPlayer=near;
        if(e.kind==='boss'&&d<B.bossSlamRadius+10&&!e.slamCd){
          e.action='slam';e.danger=true;e.tell=B.bossSlamTell;e.tellTotal=B.bossSlamTell;e.slamCd=B.bossSlamCooldown;
          g.hazards.push({id:++g.serial,x:e.x,y:e.y,r:B.bossSlamRadius,remaining:B.bossSlamTell,total:B.bossSlamTell,damage:26,kind:'shockwave'});
          event(g,'bossslam',e.x,e.y,'DODGE · SHOCKWAVE');
        }else if(e.kind==='boss'&&!e.repositionCd){
          repositionBoss(g,e,p);vx=e.repositionX*B.bossRepositionSpeed;vy=e.repositionY*B.bossRepositionSpeed;
        }else if(e.tell<=0){
          e.cooldown-=dt;
          if(e.cooldown<=0&&(!c.melee||d<=c.range+B.radius-24)){
            e.burst++;e.action='attack';e.danger=e.kind==='mortar'||e.kind==='railgun'||(e.kind==='pistol'&&e.burst%3===0)||(e.kind==='boss'&&e.burst%2===0);
            if(e.kind==='railgun'){const aim=predictedAim(g,e,p,850);e.angle=aim.angle;}
            e.tell=e.danger&&e.kind!=='railgun'?Math.max(.8,c.tell):c.tell;e.tellTotal=e.tell;e.target=p.id;
          }else{
            const desired=c.melee?c.range*.7:e.kind==='railgun'?430:e.kind==='boss'?250:e.kind==='shotgun'?145:210;
            const toward=d>desired?1:d<desired-40?-.65:0;
            vx=Math.cos(e.angle)*toward*c.speed;vy=Math.sin(e.angle)*toward*c.speed;
            if(!c.melee){vx+=Math.cos(e.angle+Math.PI/2)*.25*c.speed;vy+=Math.sin(e.angle+Math.PI/2)*.25*c.speed;}
          }
        }
      }else if(e.tell>0&&e.fireReadyAt==null){
        e.tell-=dt;
        if(e.tell<=0){
          if(e.action==='slam'){e.tell=0;e.cooldown=.65;repositionBoss(g,e,p);}
          else if(e.action==='parry'){e.tell=0;e.guardLeft=.3;e.cooldown=Math.max(e.cooldown,.5);}
          else if(c.melee){e.tell=0;const target=alive.find(p=>p.id===e.target);if(target)fire(g,e,target);e.cooldown=c.rate;}
          else {e.tell=.001;e.fireReadyAt=g.time;}
        }
      }
    }
    if(e.stun>0)continue;
    let rx=0,ry=0;
    for(const a of peers)if(a.id!==e.id){
      const dx=e.x-a.x,dy=e.y-a.y,gap=Math.hypot(dx,dy);
      if(gap<B.separationRadius){const force=1-gap/B.separationRadius;rx+=(gap?dx/gap:e.id<a.id?-1:1)*force;ry+=(gap?dy/gap:0)*force;}
    }
    const magnitude=Math.max(1,Math.hypot(rx,ry));
    move(g,e,(vx+rx/magnitude*B.separationSpeed)*dt,(vy+ry/magnitude*B.separationSpeed)*dt,e.kind==='boss'?29:18);
  }
  // Completed telegraphs take turns in order; an enemy volley stays intact.
  if(g.time+1e-9>=(g.nextEnemyShot??0)) {
    const e=g.enemies.filter(e=>e.hp>0&&e.fireReadyAt!=null).sort((a,b)=>a.fireReadyAt-b.fireReadyAt||a.id-b.id)[0];
    if(e){const p=alive.reduce((a,b)=>distance(a,e)<distance(b,e)?a:b);fire(g,e,p);e.fireReadyAt=null;e.tell=0;e.cooldown=ENEMIES[e.kind].rate/(1+g.room*.07);g.nextEnemyShot=g.time+B.enemyShotGap;if(e.kind==='boss')repositionBoss(g,e,p);}
  }
  for(const b of g.bullets) {
    if(b.kind==='homing') {
      const target=b.owner
        ? g.enemies.find(e=>e.hp>0&&e.id===b.target)||deflectionTarget(g,b,Math.atan2(b.vy,b.vx))
        : alive.find(p=>p.id===b.target)||alive[0];
      if(target){b.target=target.id;steer(b,target,dt*1.35);}
    }
    const prev={x:b.x,y:b.y};b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(b.x<25||b.x>g.width-25||b.y<25||b.y>g.height-25||g.obstacles.some(o=>inside(b,o,b.radius||3))){b.life=0;continue;}
    if(b.owner) {
      for(const e of g.enemies)if(e.hp>0&&segmentDistance(e,prev,b)<(e.kind==='boss'?29:18)){const p=g.players.find(p=>p.id===b.owner);e.hp-=b.damage;event(g,'hit',e.x,e.y,`${Math.round(b.damage)}`,p?.id);if(e.hp<=0)kill(g,e,p);b.life=0;break;}
    } else for(const p of alive)if(segmentDistance(p,prev,b)<B.radius+(b.radius||3)+2){
      const outcome=hitPlayer(g,p,b.damage,!b.unparryable,Math.atan2(-b.vy,-b.vx));
      if(outcome==='immune')continue;
      if(outcome==='perfect'||outcome==='regular') {
        // Preserve the player's aim, with a small correction toward nearby visible enemies.
        const s=Math.hypot(b.vx,b.vy)*B.deflectSpeed;
        b.x=p.x;b.y=p.y;
        const assisted=deflectionTarget(g,b,p.angle,B.deflectAssistCone);
        const a=p.angle+(assisted?clamp(angleDiff(Math.atan2(assisted.y-p.y,assisted.x-p.x),p.angle),-B.deflectAssistTurn,B.deflectAssistTurn):0);
        b.vx=Math.cos(a)*s;b.vy=Math.sin(a)*s;b.owner=p.id;b.damage*=outcome==='perfect'?2:1;b.life=4;
        b.target=(assisted|| (b.kind==='homing'?deflectionTarget(g,b,a):null))?.id??null;
        b.x=p.x+Math.cos(a)*24;b.y=p.y+Math.sin(a)*24;
      }else b.life=0;
      break;
    }
  }
  for(const h of g.hazards) {
    if(h.kind==='beam'&&h.remaining>0){
      for(const p of alive)if(segmentDistance(p,h,{x:h.ex,y:h.ey})<h.r+B.radius&&g.time>=(h.nextHits[p.id]||0)){
        h.nextHits[p.id]=g.time+.2;
        hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));
      }
      h.remaining-=dt;
    }else{
      h.remaining-=dt;if(h.remaining<=0&&!h.done){h.done=true;event(g,'explosion',h.x,h.y);for(const p of alive)if(distance(p,h)<h.r+B.radius)hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));}
    }
  }
  g.hazards=g.hazards.filter(h=>h.kind==='beam'?h.remaining>0:h.remaining>-.25);g.bullets=g.bullets.filter(b=>b.life>0);g.enemies=g.enemies.filter(e=>e.hp>0);
  if(!g.players.some(p=>p.hp>0)){g.phase='death';return;}
  if(!g.enemies.length) {
    g.bullets=[];g.hazards=[];
    if(g.room===B.encounters) {g.phase='victory';event(g,'victory',g.width/2,g.height/2);}
    else {g.phase='upgrade';for(const p of g.players){p.chosen=p.hp<=0;const pool=[...UPGRADES];p.offers=[];for(let n=0;n<3;n++){const j=Math.floor(random(g)*pool.length);p.offers.push(pool.splice(j,1)[0].id);}}event(g,'clear',g.width/2,g.height/2,'ROOM CLEARED');}
  }
}
