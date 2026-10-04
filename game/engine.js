import {specialEnemy,fireSpecial,frontShield,shieldBlocks,prepareProjectile,ricochetMove,projectileDistance,dartHit,specialHazard,dashBlast} from './level2.js';
import { ObjectPool, SpatialGrid, compact } from './performance.js';
import { BALANCE as B, WEAPONS, ENEMIES, UPGRADES, LEVELS, isBoss } from './config.js';
const runtimes=new WeakMap(),hazardClocks=new WeakMap();
function pooledHazard(){const h={};hazardClocks.set(h,{});return h;}
const EMPTY_INPUT={};
const PLAYER_TIMERS=['attackCd','parryCd','dashCd','invuln','swing','streakLeft','stun'];
const ENEMY_TIMERS=['stun','guardLeft','parryAttemptCd','swing','recoil','repositionLeft','repositionCd','slamCd'];
const SHOTGUN_OFFSETS=[-.3,-.15,0,.15,.3],BOSS_OFFSETS=[-.5,-.25,0,.25,.5],SINGLE_OFFSET=[0];
const liveEnemy=e=>e.hp>0,liveBullet=b=>b.life>0,liveHazard=h=>h.kind==='mine'||(h.kind==='beam'?h.remaining>0:h.remaining>-.25);
function runtime(g,prewarm=false) {
  let r=runtimes.get(g);if(r)return r;
  r={bullets:new ObjectPool(()=>({}),prewarm?256:0),enemies:new ObjectPool(()=>({}),prewarm?64:0),hazards:new ObjectPool(pooledHazard,prewarm?32:0),events:new ObjectPool(()=>({}),prewarm?72:0),alive:[],peers:[],melee:[],separation:new SpatialGrid(B.separationRadius),collisions:new SpatialGrid(64),collisionDirty:true,aim:{},beamEnd:{}};
  runtimes.set(g,r);return r;
}
function clear(array,pool){for(const value of array)pool.release(value);array.length=0;}
function bullet(g,x,y,vx,vy,damage,kind,predictive,unparryable,target,radius) {
  const b=runtime(g).bullets.acquire();b.id=++g.serial;b.x=x;b.y=y;b.vx=vx;b.vy=vy;b.damage=damage;b.kind=kind;b.predictive=predictive;b.unparryable=unparryable;b.target=target;b.radius=radius;b.owner='';b.life=7;
  b.ricochet=undefined;b.bounces=undefined;b.wave=undefined;b.waveAngle=undefined;b.waveSpeed=undefined;b.waveAge=undefined;b.centerX=undefined;b.centerY=undefined;b.thrower=undefined;b.flightAge=undefined;b.returning=undefined;b.curveSide=undefined;b.contactAt=undefined;b.contactPlayer=undefined;
  g.bullets.push(b);return b;
}
function hazard(g,x,y,r,remaining,damage,kind,sx,sy,ex,ey) {
  const h=runtime(g).hazards.acquire();h.id=++g.serial;h.x=x;h.y=y;h.r=r;h.remaining=remaining;h.total=remaining;h.damage=damage;h.kind=kind;h.sx=sx;h.sy=sy;h.ex=ex;h.ey=ey;h.done=undefined;h.triggerRadius=undefined;h.armed=undefined;h.source=undefined;h.flight=undefined;h.settle=undefined;h.target=undefined;h.dashOnly=undefined;
  let hits=hazardClocks.get(h);if(!hits){hits={};hazardClocks.set(h,hits);}for(const key in hits)delete hits[key];h.nextHits=kind==='beam'?hits:undefined;g.hazards.push(h);return h;
}
function nearest(players,e){let best=players[0];for(let i=1;i<players.length;i++)if(!(distance(best,e)<distance(players[i],e)))best=players[i];return best;}
function rebuildCollisions(g,r){r.collisions.reset(g.width,g.height);for(let i=0;i<g.enemies.length;i++){const e=g.enemies[i];if(e.hp>0)r.collisions.insert(i,e.x,e.y);}r.collisionDirty=false;}
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
  const g = { seed, time: 0, stage:0, room: 0, phase: 'combat', players, enemies: [], bullets: [], hazards: [], obstacles: [], events: [], serial: 0, eventSerial: 0, width: 900, height: 570, intro: 1.8, encounterParty: players.length };
  runtime(g,true);generateRoom(g);return g;
}
export function event(g, kind, x, y, text = '', who = '') {
  const pool=runtime(g).events;if(g.events.length>=70)pool.release(g.events.shift());
  const e=pool.acquire();e.id=++g.eventSerial;e.kind=kind;e.x=x;e.y=y;e.text=text;e.who=who;e.time=g.time;g.events.push(e);
}
export function spawnEnemy(g, kind, x, y) {
  const c = ENEMIES[kind]; const scale = 1+g.room*.12 + (g.encounterParty-1)*(isBoss(kind)?.48:.12);
  const e=runtime(g).enemies.acquire();
  e.id=++g.serial;e.kind=kind;e.x=x;e.y=y;e.hp=c.hp*scale;e.maxHp=c.hp*scale;e.angle=0;e.cooldown=1+random(g);e.tell=0;e.target='';e.burst=0;e.danger=false;e.stun=0;e.guardLeft=0;e.guardAge=0;e.nearPlayer=false;e.parryAttemptCd=0;e.action='attack';e.swing=0;e.repositionLeft=0;e.repositionCd=0;e.slamCd=0;
  e.routeX=undefined;e.routeY=undefined;e.dead=undefined;e.fireReadyAt=undefined;e.tellTotal=undefined;e.recoil=undefined;e.repositionX=undefined;e.repositionY=undefined;e.minesLaid=kind==='miner'?0:undefined;e.mineTimer=undefined;e.wanderTimer=undefined;e.wanderAngle=undefined;e.primed=undefined;e.aiVX=undefined;e.aiVY=undefined;
  g.enemies.push(e); return e;
}
export function generateRoom(g) {
  g.encounterParty = g.players.length; g.width = 900 + (g.encounterParty-1)*120; g.height = 570 + (g.encounterParty-1)*45;
  const r=runtime(g);clear(g.enemies,r.enemies);clear(g.bullets,r.bullets);clear(g.hazards,r.hazards);r.collisionDirty=true;
  g.nextEnemyShot=g.time;g.obstacles=[];g.intro=1.5;
  // Broad lanes and safe entrance keep random cover from creating unreachable enemies.
  const count = g.room===B.encounters?2:3+Math.floor(random(g)*3);
  for(let i=0;i<count;i++) {
    const o={x:300+random(g)*(g.width-470),y:85+random(g)*(g.height-210),w:40+Math.floor(random(g)*2)*24,h:40};
    if(g.obstacles.every(a=>Math.hypot(a.x-o.x,a.y-o.y)>110))g.obstacles.push(o);
  }
  g.players.forEach((p,i)=>{p.x=130;p.y=g.height/2+(i-(g.players.length-1)/2)*40;p.invuln=1.5;p.chosen=false;p.offers=[];p.dashLeft=0;p.parryLeft=0;p.swing=0;p.blocking=false;p.guardHeld=false;p.stun=0;p.vx=0;p.vy=0;p.magnetLeft=undefined;});
  if(g.room===B.encounters) {
    g.obstacles=g.obstacles.filter(o=>!inside({x:g.width-210,y:g.height/2},o,50));
    if((g.stage??0)===0){spawnEnemy(g,'boss',g.width-210,g.height/2);for(let i=1;i<g.encounterParty;i++)spawnEnemy(g,i%2?'bow':'mortar',g.width-140,100+i*90);}
    else {g.obstacles=g.obstacles.filter(o=>!inside({x:g.width-230,y:g.height/2-100},o,50)&&!inside({x:g.width-170,y:g.height/2+100},o,50));spawnEnemy(g,'twinBomber',g.width-230,g.height/2-100);spawnEnemy(g,'twinRicochet',g.width-170,g.height/2+100);}
  } else {
    const kinds=['bow','pistol','homing','shotgun','mortar'];
    const n=B.baseEnemies+g.room+B.partyEnemies*(g.encounterParty-1)+((g.stage??0)>0?2:0);
    for(let i=0;i<n;i++) {
      let kind=i%2===0?(i%4===0?'brawler':'lancer'):kinds[(g.room+i)%Math.min(5,2+g.room+g.encounterParty-1)];
      if(g.room>=2&&i===1)kind='railgun';
      if(g.room===3&&i===0)kind='mortar';
      if((g.stage??0)>0)kind=LEVELS[g.stage].enemies[(i+g.room*3)%LEVELS[g.stage].enemies.length];
      let pos={x:380+random(g)*(g.width-440),y:70+random(g)*(g.height-140)};
      for(let k=0;k<20&&g.obstacles.some(o=>inside(pos,o,30));k++)pos={x:380+random(g)*(g.width-440),y:70+random(g)*(g.height-140)};
      spawnEnemy(g,kind,pos.x,pos.y);
    }
  }
  if(g.sceneryStage!==(g.stage??0)){g.scenerySeed=g.seed;g.sceneryStage=g.stage??0;}
}
function insideXY(x,y,o,r=0){return x>o.x-r&&x<o.x+o.w+r&&y>o.y-r&&y<o.y+o.h+r;}
function inside(p,o,r=0){return insideXY(p.x,p.y,o,r);}
export function move(g,p,dx,dy,r=B.radius) {
  p.x=clamp(p.x+dx,30+r,g.width-30-r);
  for(const o of g.obstacles)if(inside(p,o,r))p.x=dx>0?o.x-r:o.x+o.w+r;
  p.y=clamp(p.y+dy,30+r,g.height-30-r);
  for(const o of g.obstacles)if(inside(p,o,r))p.y=dy>0?o.y-r:o.y+o.h+r;
}
function segmentDistance(p,ax,ay,bx,by) {
  const vx=bx-ax,vy=by-ay,t=clamp(((p.x-ax)*vx+(p.y-ay)*vy)/(vx*vx+vy*vy||1),0,1);
  return Math.hypot(p.x-ax-t*vx,p.y-ay-t*vy);
}
function blocked(g,a,b) {
  for(const o of g.obstacles)for(let t=0;t<=1;t+=.1)if(insideXY(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,o))return true;return false;
}
// Exact segment/rectangle test; movement routes inflate cover by body radius.
function clearSegment(g,x,y,tx,ty,margin=0){
  const dx=tx-x,dy=ty-y;
  for(const o of g.obstacles){
    let start=0,end=1;
    const left=o.x-margin,right=o.x+o.w+margin,top=o.y-margin,bottom=o.y+o.h+margin;
    if(dx===0){if(x<left||x>right)continue;}else{const a=(left-x)/dx,b=(right-x)/dx;start=Math.max(start,Math.min(a,b));end=Math.min(end,Math.max(a,b));}
    if(start>end)continue;
    if(dy===0){if(y<top||y>bottom)continue;}else{const a=(top-y)/dy,b=(bottom-y)/dy;start=Math.max(start,Math.min(a,b));end=Math.min(end,Math.max(a,b));}
    if(start<=end)return false;
  }
  return true;
}
export function hasLineOfSight(g,a,b){return clearSegment(g,a.x,a.y,b.x,b.y)&&!shieldBlocks(g,a,b,b);}
function seekSight(g,e,p){
  const radius=isBoss(e.kind)?29:18;
  if(e.routeX!=null&&(Math.hypot(e.routeX-e.x,e.routeY-e.y)<6||!clearSegment(g,e.x,e.y,e.routeX,e.routeY,radius)))e.routeX=undefined;
  if(e.routeX==null){
    let best=Infinity;
    for(const o of g.obstacles)for(let corner=0;corner<4;corner++){
      const x=corner%2?o.x+o.w+radius+8:o.x-radius-8,y=corner<2?o.y-radius-8:o.y+o.h+radius+8;
      const gap=Math.hypot(x-e.x,y-e.y);
      if(gap<8||x<30+radius||x>g.width-30-radius||y<30+radius||y>g.height-30-radius||!clearSegment(g,e.x,e.y,x,y,radius))continue;
      const score=gap+Math.hypot(p.x-x,p.y-y);if(score<best){best=score;e.routeX=x;e.routeY=y;}
    }
  }
  return e.routeX==null?Math.atan2(p.y-e.y,p.x-e.x)+(e.id%2?1:-1)*Math.PI/2:Math.atan2(e.routeY-e.y,e.routeX-e.x);
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
      if(p.weapon==='longsword')runtime(g).collisionDirty=true;
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
  const candidates=runtime(g).melee;candidates.length=0;for(const e of g.enemies)if(e.hp>0&&distance(e,p)<=w.range+29)candidates.push(e);
  candidates.sort((a,b)=>distance(a,p)-distance(b,p));
  for(const e of candidates) {
    const gap=distance(e,p),radius=isBoss(e.kind)?29:18;
    // Intersect the body with the swing sector; touching enemies cannot fall through its center.
    const bodyAngle=Math.asin(Math.min(1,radius/(gap||1)));
    if(e.hp<=0||gap>w.range+radius||(gap>B.radius+radius&&Math.abs(angleDiff(Math.atan2(e.y-p.y,e.x-p.x),p.angle))>w.arc/2+bodyAngle)||blocked(g,p,e)||shieldBlocks(g,p,e,e))continue;
    if(frontShield(e,p.x,p.y)){event(g,'shieldhit',e.x,e.y,'FLANK THE SHIELD',p.id);continue;}
    if(e.guardLeft>0&&Math.abs(angleDiff(Math.atan2(p.y-e.y,p.x-e.x),e.angle))<B.parryCone){
      p.stun=B.playerParryStun;p.blocking=false;p.guardHeld=false;p.parryLeft=0;p.dashLeft=0;p.swing=0;
      e.guardLeft=0;event(g,'enemyparry',p.x,p.y,'PARRIED · STUNNED',p.id);break;
    }
    const d=p.name==='hacker'?e.hp:w.damage*p.damage*(1+p.streak*B.streakBonus);e.hp-=d;p.internal=Math.max(0,p.internal-p.cleanse);
    event(g,'hit',e.x,e.y,`${Math.round(d)}`,p.id);
    if(e.hp<=0)kill(g,e,p);
    if(++n>=w.targets)break;
  }
}
function deflectionTarget(g,b,angle,cone=Math.PI) {
  let best,nearestDistance=Infinity;
  for(const e of g.enemies){if(e.hp<=0)continue;const gap=distance(e,b);if(gap>=nearestDistance||blocked(g,b,e)||Math.abs(angleDiff(Math.atan2(e.y-b.y,e.x-b.x),angle))>cone)continue;best=e;nearestDistance=gap;}
  return best;
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
  const aim=runtime(g).aim;aim.predictive=predictive;aim.angle=predictive?Math.atan2(y-e.y,x-e.x):e.angle;return aim;
}
function beamEnd(g,e,angle) {
  const end=runtime(g).beamEnd;end.x=e.x;end.y=e.y;
  const cosine=Math.cos(angle),sine=Math.sin(angle),maximum=Math.hypot(g.width,g.height);
  for(let length=24;length<maximum;length+=4){
    const x=e.x+cosine*length,y=e.y+sine*length;
    if(x<25||x>g.width-25||y<25||y>g.height-25||g.obstacles.some(o=>insideXY(x,y,o,9)))break;
    end.x=x;end.y=y;
  }
  return end;
}
function fire(g,e,p) {
  if(!hasLineOfSight(g,e,p))return false;
  e.recoil=.24;
  const c=ENEMIES[e.kind],base=e.angle;
  if(fireSpecial(g,e,p,LEVEL2_API))return;
  if(c.melee){
    e.swing=.2;event(g,'meleeswing',e.x,e.y);
    if(distance(e,p)<=c.range+B.radius&&!blocked(g,e,p)&&Math.abs(angleDiff(Math.atan2(p.y-e.y,p.x-e.x),e.angle))<=c.arc/2){
      const result=hitPlayer(g,p,c.damage*(1+g.room*.08),true,Math.atan2(e.y-p.y,e.x-p.x));
      if(result==='perfect'||result==='regular'){e.stun=B.enemyMeleeStun;e.guardLeft=0;event(g,'enemystun',e.x,e.y,'STUNNED');}
    }
    return;
  }
  if(e.kind==='railgun') {const end=beamEnd(g,e,base);hazard(g,e.x,e.y,9,1,c.damage*.4,'beam',undefined,undefined,end.x,end.y);event(g,'beam',e.x,e.y);return;}
  if(e.kind==='mortar') {
    const vx=clamp(p.vx||0,-B.speed*p.speed,B.speed*p.speed),vy=clamp(p.vy||0,-B.speed*p.speed,B.speed*p.speed);
    const x=clamp(p.x+vx*.65,45,g.width-45),y=clamp(p.y+vy*.65,45,g.height-45);
    hazard(g,x,y,60,1.2,c.damage,undefined,e.x,e.y);event(g,'mortar',e.x,e.y);return;
  }
  const offsets=e.kind==='shotgun'?SHOTGUN_OFFSETS:e.kind==='boss'?BOSS_OFFSETS:SINGLE_OFFSET;
  for(const off of offsets) {const aim=predictedAim(g,e,p,c.projectile),a=(aim.predictive?aim.angle:base)+off;bullet(g,e.x+Math.cos(a)*24,e.y+Math.sin(a)*24,Math.cos(a)*c.projectile,Math.sin(a)*c.projectile,c.damage*(1+g.room*.08),e.kind,aim.predictive,e.danger,p.id,c.projectileRadius||3);}
  if(e.kind==='boss'&&e.hp<e.maxHp*.5) {
    for(let i=0;i<10;i++){const aim=predictedAim(g,e,p,165),a=aim.predictive?aim.angle:i*Math.PI/5+g.time;bullet(g,e.x,e.y,Math.cos(a)*165,Math.sin(a)*165,10,'bow',aim.predictive,e.danger,p.id);}
    hazard(g,p.x,p.y,55,1.5,20,undefined,e.x,e.y);
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
  if(g.phase==='levelclear'){
    const ready=g.players.some(p=>p.hp>0&&(inputs[p.id]?.interact||0)>p.seenInteract);
    if(ready){for(const p of g.players)p.seenInteract=inputs[p.id]?.interact||0;g.stage=(g.stage??0)+1;g.room=0;g.phase='combat';generateRoom(g);}
    return;
  }
  if(g.phase!=='combat') {
    if(g.phase==='upgrade'&&g.players.every(p=>p.hp<=0||p.chosen)) {
      const ready=g.players.some(p=>(inputs[p.id]?.interact||0)>p.seenInteract);
      if(ready) {g.players.forEach(p=>{p.seenInteract=inputs[p.id]?.interact||0;/* Decision: fallen co-op allies revive between rooms, never mid-fight. */if(p.hp<=0)p.hp=p.maxHp*.5;else p.hp=Math.min(p.maxHp,p.hp+8);p.internal=0;});g.room++;g.phase='combat';generateRoom(g);}
    }
    return;
  }
  g.intro=Math.max(0,g.intro-dt);
  for(const p of g.players) {
    for(const k of PLAYER_TIMERS)p[k]=Math.max(0,(p[k]||0)-dt);
    if(p.magnetLeft>0)p.magnetLeft=Math.max(0,p.magnetLeft-dt);
    if(!p.streakLeft)p.streak=0;
    if(p.parryLeft>0){p.parryLeft-=dt;p.parryAge+=dt;if(p.parryLeft<=0&&!p.parrySuccess){p.streak=0;event(g,'miss',p.x,p.y,'MISS',p.id);}}
    const i=inputs[p.id]||EMPTY_INPUT; if(p.hp<=0)continue;
    if(Number.isFinite(i.angle))p.angle=i.angle;
    if(p.stun>0){p.blocking=false;p.guardHeld=false;p.vx=0;p.vy=0;p.seenParry=i.parry||0;p.seenDash=i.dash||0;continue;}
    const previousX=p.x,previousY=p.y;
    let mx=clamp(i.mx||0,-1,1),my=clamp(i.my||0,-1,1),norm=Math.hypot(mx,my)||1;mx/=norm;my/=norm;
    if((i.dash||0)>p.seenDash) {p.seenDash=i.dash;if(!p.dashCd){p.dashCd=B.dashCooldown;p.dashLeft=p.dashTime;p.dashAge=0;p.dx=mx||my?mx:Math.cos(p.angle);p.dy=mx||my?my:Math.sin(p.angle);event(g,'dash',p.x,p.y,'',p.id);}}
    if((i.parry||0)>p.seenParry) {p.seenParry=i.parry;if(!p.parryCd){p.parryCd=B.parryCooldown;p.parryLeft=WEAPONS[p.weapon].parry;p.parryAge=0;p.parrySuccess=false;event(g,'guard',p.x,p.y,'',p.id);}}
    if(p.dashLeft>0){move(g,p,p.dx*B.dashSpeed*p.dashPower*dt,p.dy*B.dashSpeed*p.dashPower*dt);p.dashLeft-=dt;p.dashAge+=dt;}
    else move(g,p,mx*B.speed*p.speed*(i.guard&&!p.shieldBroken&&p.parryLeft<=0?B.blockSpeed:1)*dt,my*B.speed*p.speed*(i.guard&&!p.shieldBroken&&p.parryLeft<=0?B.blockSpeed:1)*dt);
    p.guardHeld=i.guard===true&&p.dashLeft<=0;
    p.blocking=i.guard===true&&!p.shieldBroken&&p.parryLeft<=0&&p.dashLeft<=0;
    p.vx=dt?(p.x-previousX)/dt:0;p.vy=dt?(p.y-previousY)/dt:0;
    if(i.attack&&!p.attackCd)melee(g,p);
  }
  const r=runtime(g),alive=r.alive;alive.length=0;for(const p of g.players)if(p.hp>0)alive.push(p);
  if(!alive.length){g.phase='death';return;}
  // Evaluate separation against a shared snapshot so peers push apart symmetrically.
  const peers=r.peers;let peerCount=0;
  for(const e of g.enemies)if(e.hp>0){let a=peers[peerCount];if(!a)peers[peerCount]=a={};a.id=e.id;a.x=e.x;a.y=e.y;peerCount++;}
  const useGrid=peerCount>=32;if(useGrid){r.separation.reset(g.width,g.height);for(let i=0;i<peerCount;i++)r.separation.insert(i,peers[i].x,peers[i].y);}
  for(const e of g.enemies) {
    if(e.hp<=0)continue;
    for(const key of ENEMY_TIMERS)e[key]=Math.max(0,(e[key]||0)-dt);
    if(e.stun>0)continue;
    const c=ENEMIES[e.kind],p=nearest(alive,e),d=distance(e,p);
    let vx=0,vy=0;
    if(g.intro<=0){
      if(specialEnemy(g,e,p,dt,LEVEL2_API)){vx=e.aiVX;vy=e.aiVY;}
      else if(!hasLineOfSight(g,e,p)&&!(e.action==='slam'&&e.tell>0)){
        e.tell=0;e.fireReadyAt=null;e.tellTotal=undefined;e.action='attack';e.repositionLeft=0;e.cooldown=Math.max(e.cooldown,.1);
        e.angle=Math.atan2(p.y-e.y,p.x-e.x);const direction=seekSight(g,e,p);vx=Math.cos(direction)*c.speed;vy=Math.sin(direction)*c.speed;
      }else if(e.kind==='boss'&&e.repositionLeft>0){
        vx=e.repositionX*B.bossRepositionSpeed;vy=e.repositionY*B.bossRepositionSpeed;
      }else if(e.tell<=0&&e.fireReadyAt==null&&e.guardLeft<=0){
        e.routeX=undefined;
        e.angle=Math.atan2(p.y-e.y,p.x-e.x);
        const near=d<B.enemyParryRange;
        if(!isBoss(e.kind)&&near&&!e.nearPlayer&&!e.parryAttemptCd){
          e.parryAttemptCd=2;
          if(random(g)<B.enemyParryChance){e.action='parry';e.danger=false;e.tell=c.tell;e.target=p.id;}
        }
        e.nearPlayer=near;
        if(e.kind==='boss'&&d<B.bossSlamRadius+10&&!e.slamCd){
          e.action='slam';e.danger=true;e.tell=B.bossSlamTell;e.tellTotal=B.bossSlamTell;e.slamCd=B.bossSlamCooldown;
          hazard(g,e.x,e.y,B.bossSlamRadius,B.bossSlamTell,20,'shockwave');
          event(g,'bossslam',e.x,e.y,'DODGE · SHOCKWAVE');
        }else if(e.kind==='boss'&&!e.repositionCd){
          repositionBoss(g,e,p);vx=e.repositionX*B.bossRepositionSpeed;vy=e.repositionY*B.bossRepositionSpeed;
        }else if(e.tell<=0){
          e.cooldown-=dt;
          if(e.cooldown<=0&&(!c.melee||d<=c.range+B.radius-24)){
            e.burst++;e.action='attack';e.danger=e.kind==='mortar'||e.kind==='railgun'||(e.kind==='pistol'&&e.burst%3===0)||(e.kind==='boss'&&e.burst%2===0);
            e.tell=e.danger&&e.kind!=='railgun'?Math.max(.8,c.tell):c.tell;e.tellTotal=e.tell;e.target=p.id;
          }else{
            const desired=c.melee?c.range*.7:e.kind==='twinBomber'?180:e.kind==='railgun'?430:e.kind==='boss'?250:e.kind==='shotgun'?145:210;
            const toward=d>desired?1:d<desired-40?-.65:0;
            vx=Math.cos(e.angle)*toward*c.speed;vy=Math.sin(e.angle)*toward*c.speed;
            if(e.kind==='twinBomber'){vx+=Math.cos(e.angle+Math.PI/2)*.65*c.speed;vy+=Math.sin(e.angle+Math.PI/2)*.65*c.speed;}
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
    const nearby=useGrid?r.separation.query(e.x-B.separationRadius,e.y-B.separationRadius,e.x+B.separationRadius,e.y+B.separationRadius):null;
    for(let i=0;i<(nearby?nearby.length:peerCount);i++){const a=peers[nearby?nearby[i]:i];if(a.id===e.id)continue;
      const dx=e.x-a.x,dy=e.y-a.y,gap=Math.hypot(dx,dy);
      if(gap<B.separationRadius){const force=1-gap/B.separationRadius;rx+=(gap?dx/gap:e.id<a.id?-1:1)*force;ry+=(gap?dy/gap:0)*force;}
    }
    const magnitude=Math.max(1,Math.hypot(rx,ry));
    move(g,e,(vx+rx/magnitude*B.separationSpeed)*dt,(vy+ry/magnitude*B.separationSpeed)*dt,isBoss(e.kind)?29:18);
  }
  // Completed telegraphs take turns in order; an enemy volley stays intact.
  if(g.time+1e-9>=(g.nextEnemyShot??0)) {
    let e;for(const candidate of g.enemies)if(candidate.hp>0&&candidate.fireReadyAt!=null&&(!e||candidate.fireReadyAt<e.fireReadyAt||(candidate.fireReadyAt===e.fireReadyAt&&candidate.id<e.id)))e=candidate;
    if(e){const p=nearest(alive,e);const fired=fire(g,e,p)!==false;e.fireReadyAt=null;e.tell=0;e.cooldown=fired?ENEMIES[e.kind].rate/(1+g.room*.07):.1;if(fired)g.nextEnemyShot=g.time+B.enemyShotGap;if(e.kind==='boss')repositionBoss(g,e,p);}
  }
  r.collisionDirty=true;
  for(const b of g.bullets) {
    if(b.life<=0)continue;
    if(b.kind==='magnet'||b.ricochet||b.wave||b.thrower||alive.some(p=>(p.magnetLeft||0)>0))prepareProjectile(g,b,dt,alive,LEVEL2_API);
    if(b.life<=0)continue;
    if(b.kind==='homing') {
      const target=b.owner
        ? g.enemies.find(e=>e.hp>0&&e.id===b.target)||deflectionTarget(g,b,Math.atan2(b.vy,b.vx))
        : alive.find(p=>p.id===b.target)||alive[0];
      if(target){b.target=target.id;steer(b,target,dt*1.35);}
    }
    const previousX=b.x,previousY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    const bounced=ricochetMove(g,b,previousX,previousY,dt,LEVEL2_API);
    if(b.life<=0)continue;
    if(b.thrower&&(b.x<29||b.x>g.width-29||b.y<29||b.y>g.height-29)){b.x=clamp(b.x,29,g.width-29);b.y=clamp(b.y,29,g.height-29);b.returning=true;}
    if(!bounced&&!b.thrower&&(b.x<25||b.x>g.width-25||b.y<25||b.y>g.height-25||g.obstacles.some(o=>inside(b,o,b.radius||3)))){b.life=0;continue;}
    if(b.owner) {
      if((g.stage??0)>0&&shieldBlocks(g,{x:previousX,y:previousY},b)){event(g,'shieldhit',b.x,b.y,'BLOCKED');b.life=0;continue;}
      if(r.collisionDirty&&g.enemies.length>=32)rebuildCollisions(g,r);
      const candidates=g.enemies.length>=32?r.collisions.query(Math.min(previousX,b.x)-29,Math.min(previousY,b.y)-29,Math.max(previousX,b.x)+29,Math.max(previousY,b.y)+29):null;
      for(let index=0;index<(candidates?candidates.length:g.enemies.length);index++){const e=g.enemies[candidates?candidates[index]:index];if(e.hp>0&&projectileDistance(b,e,previousX,previousY,b.x,b.y,segmentDistance)<(isBoss(e.kind)?29:18)){if(frontShield(e,previousX,previousY)){event(g,'shieldhit',e.x,e.y,'BLOCKED');b.life=0;break;}const p=g.players.find(p=>p.id===b.owner),damage=p?.name==='hacker'?e.hp:b.damage;e.hp-=damage;event(g,'hit',e.x,e.y,`${Math.round(damage)}`,p?.id);if(e.hp<=0)kill(g,e,p);b.life=0;break;}}
    } else for(const p of alive)if(projectileDistance(b,p,previousX,previousY,b.x,b.y,segmentDistance)<B.radius+(b.radius||3)+2){
      if(b.contactPlayer===p.id&&g.time<(b.contactAt||0))continue;
      const outcome=b.kind==='magnet'?dartHit(g,b,p,LEVEL2_API):hitPlayer(g,p,b.damage,!b.unparryable,Math.atan2(-b.vy,-b.vx));
      if(outcome==='immune')continue;
      if(outcome==='perfect'||outcome==='regular') {
        // Preserve the player's aim, with a small correction toward nearby visible enemies.
        const s=Math.hypot(b.vx,b.vy)*B.deflectSpeed;
        b.x=p.x;b.y=p.y;
        const assisted=deflectionTarget(g,b,p.angle,B.deflectAssistCone);
        const a=p.angle+(assisted?clamp(angleDiff(Math.atan2(assisted.y-p.y,assisted.x-p.x),p.angle),-B.deflectAssistTurn,B.deflectAssistTurn):0);
        b.wave=false;b.thrower=undefined;
        b.vx=Math.cos(a)*s;b.vy=Math.sin(a)*s;b.owner=p.id;b.damage*=outcome==='perfect'?2:1;b.life=4;
        b.target=(assisted|| (b.kind==='homing'?deflectionTarget(g,b,a):null))?.id??null;
        b.x=p.x+Math.cos(a)*24;b.y=p.y+Math.sin(a)*24;
      }else if(b.thrower){b.contactPlayer=p.id;b.contactAt=g.time+.35;}else b.life=0;
      break;
    }
  }
  for(const h of g.hazards) {
    if(specialHazard(g,h,dt,alive,LEVEL2_API))continue;
    if(h.kind==='beam'&&h.remaining>0){
      for(const p of alive)if(segmentDistance(p,h.x,h.y,h.ex,h.ey)<h.r+B.radius&&g.time>=(h.nextHits[p.id]||0)){
        h.nextHits[p.id]=g.time+.2;
        hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));
      }
      h.remaining-=dt;
    }else{
      h.remaining-=dt;if(h.remaining<=0&&!h.done){h.done=true;event(g,'explosion',h.x,h.y);for(const p of alive)if(distance(p,h)<h.r+B.radius){if(h.dashOnly)dashBlast(g,p,h.damage,LEVEL2_API);else hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));}}
    }
  }
  compact(g.hazards,liveHazard,r.hazards);compact(g.bullets,liveBullet,r.bullets);compact(g.enemies,liveEnemy,r.enemies);
  if(!g.players.some(p=>p.hp>0)){g.phase='death';return;}
  if(!g.enemies.length) {
    clear(g.bullets,r.bullets);clear(g.hazards,r.hazards);
    if(g.room===B.encounters) {g.phase=(g.stage??0)+1<LEVELS.length?'levelclear':'victory';event(g,g.phase==='victory'?'victory':'levelclear',g.width/2,g.height/2,g.phase==='levelclear'?'LEVEL COMPLETE':'');}
    else {g.phase='upgrade';for(const p of g.players){p.chosen=p.hp<=0;const pool=[...UPGRADES];p.offers=[];for(let n=0;n<3;n++){const j=Math.floor(random(g)*pool.length);p.offers.push(pool.splice(j,1)[0].id);}}event(g,'clear',g.width/2,g.height/2,'ROOM CLEARED');}
  }
}

const LEVEL2_API={bullet,hazard,event,random,move,hasLineOfSight,seekSight,hitPlayer,kill,distance,steer,predictedAim};
