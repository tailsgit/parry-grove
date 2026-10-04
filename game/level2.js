import {BALANCE as B,ENEMIES} from './config.js';
const TAU=Math.PI*2;
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function specialEnemy(g,e,p,dt,api){
  const c=ENEMIES[e.kind];
  if(e.kind==='miner'){
    e.mineTimer=Math.max(0,(e.mineTimer??0)-dt);
    e.mineState??='approach';e.aiVX=0;e.aiVY=0;
    const gap=api.distance(e,p);
    if(e.mineState==='hold'){
      if(e.mineTimer>1e-9)return true;
      e.mineState='approach';
    }
    if(e.mineState==='approach'){
      if(gap<=c.dropRange&&api.hasLineOfSight(g,e,p)&&e.mineTimer<=1e-9){
        const h=api.hazard(g,e.x,e.y,110,.35,c.damage,'mine');h.triggerRadius=52;h.armed=false;h.source=e.id;e.minesLaid++;e.mineTimer=c.rate;e.mineState='flee';e.wanderTimer=0;api.event(g,'mine',e.x,e.y,'MINE');
      }else{
        const angle=api.hasLineOfSight(g,e,p)?Math.atan2(p.y-e.y,p.x-e.x):api.seekSight(g,e,p);
        e.angle=angle;e.aiVX=Math.cos(angle)*c.speed;e.aiVY=Math.sin(angle)*c.speed;return true;
      }
    }
    if(gap>=c.safeDistance){e.mineState='hold';return true;}
    e.wanderTimer=(e.wanderTimer??0)-dt;
    const away=Math.atan2(e.y-p.y,e.x-p.x);
    if(e.wanderTimer<=0){e.wanderTimer=.25+api.random(g)*.45;e.wanderAngle=away+(api.random(g)-.5)*.7;}
    // Flee along clear lanes; near walls/cover choose a safe tangent rather than
    // routing toward the player. Look ahead farther than this tick's movement.
    let angle=e.wanderAngle,moving=false,best=(e.x-p.x)**2+(e.y-p.y)**2;
    for(let i=0;i<13;i++){
      const candidate=i===0?angle:away+(i-1)*TAU/12,dx=Math.cos(candidate)*55,dy=Math.sin(candidate)*55;
      const x=e.x+dx,y=e.y+dy;if(x<48||x>g.width-48||y<48||y>g.height-48)continue;
      let blocked=false;for(const o of g.obstacles){for(let n=1;n<=3;n++){const sx=e.x+dx*n/3,sy=e.y+dy*n/3;if(sx>o.x-20&&sx<o.x+o.w+20&&sy>o.y-20&&sy<o.y+o.h+20){blocked=true;break;}}if(blocked)break;}
      const score=(x-p.x)**2+(y-p.y)**2;
      if(!blocked&&score>best){angle=candidate;best=score;moving=true;if(i===0)break;}
    }
    e.angle=angle;e.aiVX=moving?Math.cos(angle)*c.speed:0;e.aiVY=moving?Math.sin(angle)*c.speed:0;
    return true;
  }
  if(e.kind==='suicide'){
    e.angle=Math.atan2(p.y-e.y,p.x-e.x);
    if(!e.primed&&api.distance(e,p)<72&&api.hasLineOfSight(g,e,p)){e.primed=true;e.tell=.22+api.random(g)*.18;e.tellTotal=e.tell;api.event(g,'fuse',e.x,e.y,'DASH AT DETONATION');}
    if(e.primed){e.tell-=dt;e.aiVX=0;e.aiVY=0;if(e.tell<=0){const h=api.hazard(g,e.x,e.y,260,0,c.damage,'suicideBlast');h.dashOnly=true;e.hp=0;api.kill(g,e,null);}}
    else{const angle=api.hasLineOfSight(g,e,p)?e.angle:api.seekSight(g,e,p);e.aiVX=Math.cos(angle)*c.speed;e.aiVY=Math.sin(angle)*c.speed;}
    return true;
  }
  return false;
}
export function fireSpecial(g,e,p,api){
  const c=ENEMIES[e.kind],a=e.angle;
  if(e.kind==='riot'){
    e.swing=.2;
    if(api.distance(e,p)<=c.range+B.radius&&Math.abs(angleDelta(Math.atan2(p.y-e.y,p.x-e.x),a))<=c.arc/2){
      const result=api.hitPlayer(g,p,c.damage,true,Math.atan2(e.y-p.y,e.x-p.x));
      if(result==='perfect'||result==='regular'){e.stun=B.enemyMeleeStun;api.event(g,'enemystun',e.x,e.y,'STUNNED');}
      else if(result!=='immune'){api.move(g,p,Math.cos(a)*125,Math.sin(a)*125);api.event(g,'push',p.x,p.y,'PUSHED',p.id);}
    }
    return true;
  }
  if(e.kind==='cluster'||e.kind==='twinBomber'){
    const h=api.hazard(g,p.x,p.y,24,.65,c.damage,'cluster',e.x,e.y);h.flight=.65;h.settle=.22;h.target=p.id;
    if(e.kind==='twinBomber'){const mine=api.hazard(g,e.x,e.y,120,.35,20,'mine');mine.triggerRadius=58;mine.armed=false;mine.source=e.id;}
    api.event(g,'mortar',e.x,e.y);return true;
  }
  if(e.kind==='boomerang'&&g.bullets.some(b=>b.thrower===e.id&&b.life>0))return true;
  if(!['ricochet','twinRicochet','magnet','sine','boomerang'].includes(e.kind))return false;
  const offsets=e.kind==='twinRicochet'?[-.18,0,.18]:[0];
  for(const offset of offsets){const aim=e.kind==='magnet'?null:api.predictedAim(g,e,p,c.projectile);const angle=(aim?.predictive?aim.angle:a)+offset,b=api.bullet(g,e.x+Math.cos(angle)*24,e.y+Math.sin(angle)*24,Math.cos(angle)*c.projectile,Math.sin(angle)*c.projectile,c.damage,e.kind,aim?.predictive||false,e.kind==='boomerang',p.id,c.projectileRadius||4);
    if(e.kind==='ricochet'||e.kind==='twinRicochet'){b.ricochet=true;b.bounces=0;}
    if(e.kind==='sine'){b.wave=true;b.waveAngle=angle;b.waveSpeed=c.projectile;b.waveAge=0;b.centerX=b.x;b.centerY=b.y;}
    if(e.kind==='boomerang'){b.thrower=e.id;b.flightAge=0;b.returning=false;b.curveSide=e.id%2?1:-1;b.contactAt=0;}
  }
  api.event(g,'fire',e.x,e.y);return true;
}

// Shield is mobile cover only for attacks coming from its front. Allies' shots
// leave from behind the shield normally; reflected/player attacks cannot pass it.
export function frontShield(e,x,y){return e.kind==='riot'&&e.stun<=0&&Math.abs(angleDelta(Math.atan2(y-e.y,x-e.x),e.angle))<Math.PI*.48;}
export function shieldBlocks(g,a,b,ignore){
  if((g.stage??0)===0)return false;
  for(const e of g.enemies){if(e===ignore||e.hp<=0||!frontShield(e,a.x,a.y))continue;const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((e.x-a.x)*dx+(e.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);if(Math.hypot(a.x+dx*t-e.x,a.y+dy*t-e.y)<26)return true;}
  return false;
}
export function prepareProjectile(g,b,dt,alive,api){
  if(b.life<=0)return;
  const marked=!b.owner?alive.find(p=>(p.magnetLeft||0)>0):null;
  if(b.kind==='magnet'&&!b.owner){const target=alive.find(p=>p.id===b.target)||alive[0];if(target)api.steer(b,target,dt*3.8);}
  if(marked)b.wave=false;
  if(b.wave){b.waveAge+=dt;b.centerX+=Math.cos(b.waveAngle)*b.waveSpeed*dt;b.centerY+=Math.sin(b.waveAngle)*b.waveSpeed*dt;const offset=Math.sin(b.waveAge*8)*38;b.vx=dt?(b.centerX-Math.sin(b.waveAngle)*offset-b.x)/dt:0;b.vy=dt?(b.centerY+Math.cos(b.waveAngle)*offset-b.y)/dt:0;}
  if(b.thrower&&!b.owner){
    const e=g.enemies.find(e=>e.id===b.thrower&&e.hp>0);if(!e){b.life=0;return;}
    b.flightAge+=dt;if(b.flightAge>=.8)b.returning=true;
    if(b.returning){if(api.distance(e,b)<30){b.life=0;return;}api.steer(b,e,dt*7);}
    else if(!marked){const angle=Math.atan2(b.vy,b.vx)+dt*.85*b.curveSide,speed=Math.hypot(b.vx,b.vy);b.vx=Math.cos(angle)*speed;b.vy=Math.sin(angle)*speed;}
  }
  if(marked)api.steer(b,marked,dt*2.8);
}
const paths=new WeakMap(),hit={t:0,nx:0,ny:0};
function rectangleHit(x,y,dx,dy,o,r){
  let enter=0,exit=1,nx=0,ny=0;
  for(let axis=0;axis<2;axis++){const origin=axis?y:x,delta=axis?dy:dx,low=(axis?o.y:o.x)-r,high=low+(axis?o.h:o.w)+r*2;
    if(delta===0){if(origin<low||origin>high)return false;continue;}
    let a=(low-origin)/delta,b=(high-origin)/delta,normal=-1;if(a>b){const t=a;a=b;b=t;normal=1;}
    if(a>enter+1e-9){enter=a;nx=axis?0:normal;ny=axis?normal:0;}else if(Math.abs(a-enter)<1e-9){if(axis)ny=normal;else nx=normal;}
    exit=Math.min(exit,b);if(enter>exit)return false;
  }
  if(enter<=1&&exit>=0&&(nx||ny)){hit.t=Math.max(0,enter);hit.nx=nx;hit.ny=ny;return true;}return false;
}
export function ricochetMove(g,b,x,y,dt,api){
  if(!b.ricochet)return false;
  let path=paths.get(b);if(!path){path={segments:new Float64Array(16),count:0};paths.set(b,path);}path.count=0;
  let remaining=dt;
  for(let pass=0;pass<4&&remaining>1e-8;pass++){
    const dx=b.vx*remaining,dy=b.vy*remaining,r=b.radius||3;let t=2,nx=0,ny=0;
    if(dx){const wall=((dx<0?25+r:g.width-25-r)-x)/dx;if(wall>=0&&wall<=1){t=wall;nx=dx<0?1:-1;}}
    if(dy){const wall=((dy<0?25+r:g.height-25-r)-y)/dy;if(wall>=0&&wall<=1){if(wall<t-1e-9){t=wall;nx=0;ny=dy<0?1:-1;}else if(Math.abs(wall-t)<1e-9)ny=dy<0?1:-1;}}
    for(const o of g.obstacles)if(rectangleHit(x,y,dx,dy,o,r)&&hit.t<t){t=hit.t;nx=hit.nx;ny=hit.ny;}
    const k=path.count++*4;path.segments[k]=x;path.segments[k+1]=y;
    x+=dx*Math.min(1,t);y+=dy*Math.min(1,t);path.segments[k+2]=x;path.segments[k+3]=y;
    if(t>1)break;
    if(b.bounces>=2){b.life=0;break;}
    b.bounces++;if(nx)b.vx=-b.vx;if(ny)b.vy=-b.vy;x+=nx*.01;y+=ny*.01;remaining*=1-t;api.event(g,'bounce',x,y);
  }
  b.x=x;b.y=y;return true;
}
export function projectileDistance(b,p,ax,ay,bx,by,distance){
  const path=b.ricochet?paths.get(b):null;if(!path)return distance(p,ax,ay,bx,by);
  let nearest=Infinity;for(let i=0;i<path.count;i++){const k=i*4,s=path.segments;nearest=Math.min(nearest,distance(p,s[k],s[k+1],s[k+2],s[k+3]));}return nearest;
}
export function dartHit(g,b,p,api){
  if(p.hp<=0||p.invuln>0||p.dashLeft>0&&p.dashAge<p.dashIframes)return 'immune';
  const source=Math.atan2(-b.vy,-b.vx),facing=Math.abs(angleDelta(source,p.angle))<B.parryCone;
  if(p.parryLeft>0&&facing)return api.hitPlayer(g,p,0,true,source);
  p.magnetLeft=B.magnetDuration;api.event(g,'magnet',p.x,p.y,'MAGNETIZED',p.id);return 'attached';
}
export function specialHazard(g,h,dt,alive,api){
  if(h.kind==='mine'){
    if(!h.armed){h.remaining-=dt;if(h.remaining<=0)h.armed=true;}
    if(h.armed&&alive.some(p=>api.distance(p,h)<h.triggerRadius+B.radius)){h.kind='mineBlast';h.remaining=.14;h.total=.14;api.event(g,'fuse',h.x,h.y,'MINE!');}
    return true;
  }
  if(h.kind==='cluster'||h.kind==='grenade'){
    h.remaining-=dt;
    if(h.remaining<=0&&h.flight>0){h.flight=0;h.sx=undefined;h.sy=undefined;h.remaining=h.settle;h.total=h.settle;api.event(g,'land',h.x,h.y,'GRENADE');}
    else if(h.remaining<=0){
      if(h.kind==='cluster'){for(let i=0;i<5;i++){const a=TAU*i/5;api.bullet(g,h.x,h.y,Math.cos(a)*260,Math.sin(a)*260,h.damage,'cluster',false,false,h.target,4);}api.event(g,'cluster',h.x,h.y);h.done=true;h.remaining=-1;}
      else{h.kind='grenadeBlast';h.remaining=0;h.total=.25;}
    }
    return true;
  }
  return false;
}
export function dashBlast(g,p,damage,api){
  if(p.hp<=0||p.dashLeft>0&&p.dashAge<p.dashIframes)return 'immune';
  const total=damage*(1-p.armor)+p.internal;p.hp=Math.max(0,p.hp-total);p.internal=0;p.streak=0;p.invuln=B.hurtIframes;api.event(g,'hurt',p.x,p.y,`−${Math.ceil(total)}`,p.id);if(!p.hp)api.event(g,'death',p.x,p.y,'DOWN',p.id);return 'hurt';
}
