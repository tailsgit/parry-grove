import {BALANCE as B,ENEMIES} from './config.js';
const TAU=Math.PI*2, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function announce(e,action,duration){e.l3Tell=action;e.action=action;e.tell=duration;e.tellTotal=duration;e.danger=true;}
function resolveTell(e,dt){if(!e.l3Tell)return null;e.tell=Math.max(0,e.tell-dt);if(e.tell>0)return null;const action=e.l3Tell;e.l3Tell=undefined;e.danger=false;return action;}

function poison(g,e,p,api){
  if(e.cloudCd>0)return;
  e.cloudCd=ENEMIES.poisoner.rate;
  const a=Math.atan2(p.y-e.y,p.x-e.x),x=e.tellX??clamp(p.x+Math.cos(a)*80,55,g.width-55),y=e.tellY??clamp(p.y+Math.sin(a)*80,55,g.height-55);e.tellX=undefined;e.tellY=undefined;
  const h=api.hazard(g,e.x,e.y,64,.85,8,'potionProjectile');h.source=e.id;h.targetX=x;h.targetY=y;h.sx=e.x;h.sy=e.y;h.flight=.85;h.flightTotal=.85;h.flightElapsed=0;h.cloudDuration=4.2;api.event(g,'toxin',x,y,'TOXIC POTION','',e.kind,'shoot');
}
function wall(g,e,p,api){
  if(e.wallCd>0)return;
  e.wallCd=ENEMIES.wallmaker.rate;
  const dx=p.x-e.x,dy=p.y-e.y,horizontal=e.tellHorizontal??Math.abs(dy)>Math.abs(dx),x=e.tellX??clamp(e.x+dx*.55,horizontal?65:90,g.width-(horizontal?65:90)),y=e.tellY??clamp(e.y+dy*.55,horizontal?90:65,g.height-(horizontal?90:65));e.tellX=undefined;e.tellY=undefined;e.tellHorizontal=undefined;
  const o={x:x-(horizontal?48:13),y:y-(horizontal?13:48),w:horizontal?96:26,h:horizontal?26:96,hp:65,maxHp:65,temporary:true,horizontal,remaining:4.5,damage:22,source:e.id};
  if(g.obstacles.every(q=>Math.hypot(q.x-x,q.y-y)>52)){g.obstacles.push(o);api.event(g,'wall',x,y,'BREAK / DODGE','',e.kind,'shoot');}
}
function throwSticky(g,e,p,c,api){
  if(api.random(g)<.48){const target=g.enemies.filter(q=>q!==e&&q.hp>0&&q.kind!=='radWorm').sort((a,b)=>api.distance(e,a)-api.distance(e,b))[0];if(target){const h=api.hazard(g,e.x,e.y,16,.7,c.damage,'stickyAttached');h.target=target.id;h.source=e.id;h.targetX=target.x;h.targetY=target.y;h.sx=e.x;h.sy=e.y;h.flight=.7;h.flightTotal=.7;h.flightElapsed=0;h.attachDuration=5.5;api.event(g,'sticky',e.x,e.y,'BOMB LOBBED','',e.kind,'shoot');return;}}
  const x=e.tellX??p.x,y=e.tellY??p.y,h=api.hazard(g,e.x,e.y,c.aoeRadius,1.25,c.damage,'stickyMine');h.flight=1.25;h.flightTotal=1.25;h.flightElapsed=0;h.targetX=x;h.targetY=y;h.sx=e.x;h.sy=e.y;h.source=e.id;h.target=p.id;api.event(g,'sticky',x,y,'CHARGE LOBBED','',e.kind,'shoot');
}
export function specialEnemy3(g,e,p,dt,api){
  const c=ENEMIES[e.kind],gap=api.distance(e,p);e.aiVX=0;e.aiVY=0;
  if(e.kind==='radMinion'){
    const head=g.enemies.find(q=>q.id===e.wormHeadId&&q.hp>0);if(!head){e.hp=0;return true;}
    const bossDx=e.x-head.x,bossDy=e.y-head.y,bossGap=Math.hypot(bossDx,bossDy)||1,playerDx=p.x-e.x,playerDy=p.y-e.y,playerGap=Math.hypot(playerDx,playerDy)||1;
    const orbit=e.id%2?1:-1,tangent=Math.atan2(bossDy,bossDx)+Math.PI/2*orbit,keepBoss=bossGap<255?1:bossGap>315?-.35:0,keepPlayer=playerGap>335?1:playerGap<245?-.8:0;
    let vx=bossDx/bossGap*keepBoss+Math.cos(tangent)*.38+playerDx/playerGap*keepPlayer,vy=bossDy/bossGap*keepBoss+Math.sin(tangent)*.38+playerDy/playerGap*keepPlayer,mag=Math.hypot(vx,vy)||1;
    e.aiVX=vx/mag*c.speed;e.aiVY=vy/mag*c.speed;e.angle=Math.atan2(playerDy,playerDx);
    const fired=resolveTell(e,dt);e.minionCd=Math.max(0,(e.minionCd??1.4)-dt);
    if(fired==='minionShot'){const a=Math.atan2(p.y-e.y,p.x-e.x),unparryable=api.random(g)<.22;api.bullet(g,e.x,e.y,Math.cos(a)*c.projectile,Math.sin(a)*c.projectile,c.damage,'radMinion',false,unparryable,p.id,5);e.minionCd=c.rate*(.8+api.random(g)*.4);api.event(g,'minionshot',e.x,e.y,unparryable?'UNPARRYABLE RAD BOLT':'RAD BOLT','',e.kind,'shoot');}
    else if(!e.l3Tell&&e.minionCd<=0){e.tellX=p.x;e.tellY=p.y;announce(e,'minionShot',c.tell);}
    return true;
  }
  if(e.kind==='radWorm'&&e.wormSegmentIndex){const head=g.enemies.find(q=>q.id===e.wormHeadId&&q.hp>0);if(!head){e.hp=0;return true;}let leader=head;for(let i=e.wormSegmentIndex-1;i>=1;i--){const previous=g.enemies.find(q=>q.wormHeadId===head.id&&q.wormSegmentIndex===i&&q.hp>0);if(previous){leader=previous;break;}}e.wormInvulnerable=head.wormActiveSegment!==e.wormSegmentIndex;const dx=leader.x-e.x,dy=leader.y-e.y,d=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),speed=clamp((d-25)*3.2,0,190);e.angle=angle;e.aiVX=Math.cos(angle)*speed;e.aiVY=Math.sin(angle)*speed;return true;}
  if(e.kind==='poisoner'||e.kind==='wallmaker'||e.kind==='sticky'||e.kind==='flamethrower'){
    const fired=resolveTell(e,dt);
    e.specialCd=Math.max(0,(e.specialCd||0)-dt);
    const ideal=e.kind==='flamethrower'?120:250, toward=gap>ideal+35?1:gap<ideal-45?-.55:0;
    const targetAngle=api.hasLineOfSight(g,e,p)?Math.atan2(p.y-e.y,p.x-e.x):api.seekSight(g,e,p);let a=targetAngle;
    if(e.kind==='flamethrower'){const turn=(B.speed*.85/190)*dt;if(e.flameLeft<=0||e.flameTrackingLeft>0)a=e.angle+clamp(Math.atan2(Math.sin(targetAngle-e.angle),Math.cos(targetAngle-e.angle)),-turn,turn);else a=e.angle;}
    e.angle=a;e.aiVX=Math.cos(a)*c.speed*toward;e.aiVY=Math.sin(a)*c.speed*toward;
    if(e.kind==='poisoner'){e.cloudCd=Math.max(0,(e.cloudCd??1)-dt);if(fired==='toxin')poison(g,e,p,api);else if(!e.l3Tell&&e.cloudCd<=0){const a=Math.atan2(p.y-e.y,p.x-e.x);e.tellX=clamp(p.x+Math.cos(a)*80,55,g.width-55);e.tellY=clamp(p.y+Math.sin(a)*80,55,g.height-55);announce(e,'toxin',c.tell);}}
    if(e.kind==='wallmaker'){e.wallCd=Math.max(0,(e.wallCd??.6)-dt);if(fired==='bulkhead'){wall(g,e,p,api);e.wallCd=c.rate;}else if(!e.l3Tell&&e.wallCd<=0){const dx=p.x-e.x,dy=p.y-e.y;e.tellHorizontal=Math.abs(dy)>Math.abs(dx);e.tellX=clamp(e.x+dx*.55,e.tellHorizontal?65:90,g.width-(e.tellHorizontal?65:90));e.tellY=clamp(e.y+dy*.55,e.tellHorizontal?90:65,g.height-(e.tellHorizontal?90:65));announce(e,'bulkhead',c.tell);}}
    if(e.kind==='sticky'){
      if(fired==='stickyBomb'){throwSticky(g,e,p,c,api);e.tellX=undefined;e.tellY=undefined;}
      else if(!e.l3Tell&&e.specialCd<=0){e.specialCd=c.rate;e.tellX=p.x;e.tellY=p.y;announce(e,'stickyBomb',c.tell);}
    }
    if(e.kind==='flamethrower'){
      e.flameCd=Math.max(0,(e.flameCd??.8)-dt);e.flameLeft=Math.max(0,(e.flameLeft||0)-dt);e.flameTrackingLeft=Math.max(0,(e.flameTrackingLeft||0)-dt);
      if(fired==='flame'){e.flameLeft=.72;e.flameTrackingLeft=.42;e.flameCd=2.8;const range=190,ex=e.x+Math.cos(a)*range,ey=e.y+Math.sin(a)*range,h=api.hazard(g,e.x,e.y,18,.72,c.damage,'beam',undefined,undefined,ex,ey);h.shortBeam=true;h.sourceKind=e.kind;h.source=e.id;h.target=p.id;h.trackLeft=.42;h.trackAngle=a;h.trackRange=range;api.event(g,'flame',e.x,e.y,'FIRE LANE','',e.kind,'shoot');}
      else if(!e.l3Tell&&e.flameCd<=0&&gap<300&&api.hasLineOfSight(g,e,p))announce(e,'flame',c.tell);
    }
    return true;
  }
  if(e.kind==='saw'){
    const fired=resolveTell(e,dt);
    e.sawVX??=(e.id%2?1:-1)*c.speed;e.sawVY??=(e.id%3?1:-1)*c.speed*.45;e.angle=Math.atan2(e.sawVY,e.sawVX);
    if(e.sawFriendly){
      const target=g.enemies.find(q=>q.hp>0&&!q.wormInvulnerable&&q.id!==e.id&&q.id!==e.sawHitId&&api.distance(e,q)<29);
      if(target){target.hp-=45;api.event(g,'hit',target.x,target.y,'45');if(target.hp<=0)api.kill(g,target,g.players.find(q=>q.id===e.sawOwner));e.sawHitId=target.id;if(e.sawDeactivateLeft<=0)e.sawDeactivateLeft=1;api.event(g,'sawhit',target.x,target.y,'SAW OVERLOAD');}
      if(e.sawDeactivateLeft>0){e.sawDeactivateLeft=Math.max(0,e.sawDeactivateLeft-dt);if(e.sawDeactivateLeft===0)e.sawFriendly=0;}
    }
    let stopped=false,charging=false,moveSpeed=c.speed;
    if(!e.sawFriendly){
      const desired=Math.atan2(p.y-e.y,p.x-e.x);
      if(e.sawChargeLeft>0){e.sawChargeLeft=Math.max(0,e.sawChargeLeft-dt);charging=true;moveSpeed=c.speed*1.7;const current=Math.atan2(e.sawVY,e.sawVX),delta=Math.atan2(Math.sin(desired-current),Math.cos(desired-current)),angle=current+clamp(delta,-.75*dt,.75*dt);e.sawVX=Math.cos(angle)*moveSpeed;e.sawVY=Math.sin(angle)*moveSpeed;}
      else if(gap>340){
        if(!(e.sawWindup>0)){e.sawWindup=1;e.tellX=p.x;e.tellY=p.y;announce(e,'sawCharge',1);}
        e.sawWindup=Math.max(0,e.sawWindup-dt);const current=Math.atan2(e.sawVY,e.sawVX),delta=Math.atan2(Math.sin(desired-current),Math.cos(desired-current)),angle=current+clamp(delta,-3.5*dt,3.5*dt);e.sawVX=Math.cos(angle)*c.speed;e.sawVY=Math.sin(angle)*c.speed;stopped=true;
        if(e.sawWindup<=0){e.sawChargeLeft=.72;e.tell=0;e.l3Tell=undefined;e.danger=false;stopped=false;charging=true;moveSpeed=c.speed*1.7;e.sawVX=Math.cos(angle)*moveSpeed;e.sawVY=Math.sin(angle)*moveSpeed;}
      }else{e.sawWindup=0;if(e.l3Tell==='sawCharge'){e.l3Tell=undefined;e.tell=0;e.danger=false;}const current=Math.atan2(e.sawVY,e.sawVX),delta=Math.atan2(Math.sin(desired-current),Math.cos(desired-current)),angle=current+clamp(delta,-.55*dt,.55*dt);e.sawVX=Math.cos(angle)*c.speed;e.sawVY=Math.sin(angle)*c.speed;}
    }else{e.sawWindup=0;e.sawChargeLeft=0;}
    e.angle=Math.atan2(e.sawVY,e.sawVX);
    let nx=e.x+e.sawVX*dt,ny=e.y+e.sawVY*dt;
    const hitX=nx<48||nx>g.width-48,hitY=ny<48||ny>g.height-48;
    const block=g.obstacles.find(o=>nx>o.x-20&&nx<o.x+o.w+20&&ny>o.y-20&&ny<o.y+o.h+20);
    if(!stopped&&(hitX||hitY||block)){
      let flipX=hitX,flipY=hitY;
      if(block){
        const left=block.x-20,right=block.x+block.w+20,top=block.y-20,bottom=block.y+block.h+20;
        if(e.x<=left||e.x>=right)flipX=true;if(e.y<=top||e.y>=bottom)flipY=true;
        if(!flipX&&!flipY){const px=Math.min(nx-left,right-nx),py=Math.min(ny-top,bottom-ny);if(px<=py)flipX=true;else flipY=true;}
      }
      // At arena edges and corners, reflect each blocked axis before considering a chase turn.
      if(block&&!hitX&&!hitY&&api.hasLineOfSight(g,e,p)){const toward=Math.atan2(p.y-e.y,p.x-e.x);e.sawVX=Math.cos(toward)*moveSpeed;e.sawVY=Math.sin(toward)*moveSpeed;}
      else{if(flipX)e.sawVX=-e.sawVX;if(flipY)e.sawVY=-e.sawVY;}
    }
    e.sawShotCd=Math.max(0,(e.sawShotCd??1.6)-dt);if(fired==='sawBurst'){const a=api.random(g)*TAU;for(let i=-1;i<=1;i++){const q=a+i*TAU/3;api.bullet(g,e.x,e.y,Math.cos(q)*c.projectile,Math.sin(q)*c.projectile,c.damage,'saw',false,false,p.id,5);}e.sawShotCd=2.4+api.random(g)*1.3;api.event(g,'sawburst',e.x,e.y,'SHARDS','',e.kind,'shoot');}else if(!e.l3Tell&&e.sawShotCd<=0&&api.hasLineOfSight(g,e,p))announce(e,'sawBurst',c.tell);
    e.aiVX=stopped?0:e.sawVX;e.aiVY=stopped?0:e.sawVY;
    if(e.sawFriendly)return true;
    for(const player of g.players)if(player.hp>0&&api.distance(e,player)<30){const a=Math.atan2(e.y-player.y,e.x-player.x),out=api.hitPlayer(g,player,c.damage,true,a);if(out==='perfect'||out==='regular'){e.sawFriendly=1;e.sawDeactivateLeft=0;e.sawOwner=player.id;e.sawHitId=undefined;e.sawVX=-e.sawVX;e.sawVY=-e.sawVY;}else if(out!=='immune'){} }
    return true;
  }
  if(e.kind==='digger'){
    const fired=resolveTell(e,dt);
    e.digMode??='hunt';e.digClock=Math.max(0,(e.digClock??2)-dt);e.wrenchCd=Math.max(0,(e.wrenchCd??1)-dt);
    e.digSurfaceLeft=Math.max(0,(e.digSurfaceLeft||0)-dt);e.digAgainCd=Math.max(0,(e.digAgainCd||0)-dt);
    if(e.hp<e.maxHp*.5&&e.digMode!=='ambush'&&e.digSurfaceLeft<=0&&e.digAgainCd<=0){e.digMode='ambush';e.digClock=.5;e.buried=1;api.event(g,'dig',e.x,e.y,'DIGGING');}
    if(e.digMode==='ambush'&&e.digClock<=0){const allies=g.enemies.filter(q=>q!==e&&q.hp>0),center=allies.length?allies.reduce((s,q)=>s+q.x,0)/allies.length:p.x;if(api.random(g)<.35){e.x=clamp(p.x+(api.random(g)<.5?-90:90),55,g.width-55);e.y=clamp(p.y+(api.random(g)-.5)*70,55,g.height-55);}else{e.x=clamp(center+(center<p.x?-85:85),55,g.width-55);e.y=clamp(p.y+(api.random(g)-.5)*90,55,g.height-55);}e.buried=0;e.digMode='hunt';e.digClock=2.3;e.digSurfaceLeft=3;e.digAgainCd=5;api.event(g,'dig',e.x,e.y,'EMERGE');}
    if(fired==='wrenchVolley'){for(let i=0;i<2;i++){const a=Math.atan2(p.y-e.y,p.x-e.x)+(i?-.16:.16);api.bullet(g,e.x,e.y,Math.cos(a)*c.projectile,Math.sin(a)*c.projectile,c.damage,'wrench',false,false,p.id,6);}e.wrenchCd=c.rate;api.event(g,'wrenches',e.x,e.y,'WRENCHES OUT','',e.kind,'shoot');}
    else if(!e.l3Tell&&e.wrenchCd<=0)announce(e,'wrenchVolley',.42);
    if(e.digMode==='ambush'){e.buried=1;e.aiVX=0;e.aiVY=0;return true;}
    const a=api.hasLineOfSight(g,e,p)?Math.atan2(p.y-e.y,p.x-e.x):api.seekSight(g,e,p);e.angle=a;e.aiVX=Math.cos(a)*c.speed*.72;e.aiVY=Math.sin(a)*c.speed*.72;return true;
  }
  if(e.kind==='radWorm'){
    const fired=resolveTell(e,dt);
    e.wormAge=(e.wormAge||0)+dt;e.wormAttack=Math.max(0,(e.wormAttack??2)-dt);e.wormCharge=Math.max(0,(e.wormCharge||0)-dt);e.wormShotCd=Math.max(0,(e.wormShotCd??2.3)-dt);e.wormApproachLeft=Math.max(0,(e.wormApproachLeft||0)-dt);e.wormApproachCd=Math.max(0,(e.wormApproachCd??3)-dt);e.wormTurn??=(e.id%2?1:-1);
    if(!e.wormCharge&&!e.wormApproachLeft&&!e.l3Tell&&e.wormApproachCd<=0){e.wormApproachCd=5+api.random(g)*3;if(api.random(g)<.55)e.wormApproachLeft=.8+api.random(g)*.45;}
    const centerX=g.width*.53,centerY=g.height*.5,angle=Math.atan2(e.y-centerY,e.x-centerX),radius=Math.hypot(e.x-centerX,e.y-centerY),approaching=e.wormApproachLeft>0,desired=e.wormCharge>0||approaching||e.l3Tell==='wormCharge'||e.l3Tell==='wormBurst'?Math.atan2(p.y-e.y,p.x-e.x):angle+Math.PI/2*e.wormTurn;
    const radial=e.wormCharge>0?0:clamp((220-radius)*.45,-45,45),speed=e.wormCharge>0?c.speed*1.9:approaching?c.speed*1.05:c.speed*.72;
    e.aiVX=Math.cos(desired)*speed+Math.cos(angle)*radial;e.aiVY=Math.sin(desired)*speed+Math.sin(angle)*radial;e.angle=desired;
    if(fired==='wormCharge'){const a=Math.atan2(p.y-e.y,p.x-e.x);e.angle=a;e.aiVX=Math.cos(a)*c.speed*1.9;e.aiVY=Math.sin(a)*c.speed*1.9;e.wormAttack=3.4+api.random(g)*1.3;e.wormCharge=.85;for(let i=-1;i<=1;i++){const q=a+i*.24,unparryable=!!e.wormShotUnparryable?.[i+1];api.bullet(g,e.x,e.y,Math.cos(q)*c.projectile,Math.sin(q)*c.projectile,c.damage,'radWorm',false,unparryable,p.id,6);}e.wormShotUnparryable=undefined;api.event(g,'wormcharge',e.x,e.y,'RADIATION CHARGE','',e.kind,'charge');}
    else if(fired==='wormBurst'){const aim=Math.atan2(p.y-e.y,p.x-e.x);e.angle=aim;for(let i=-1;i<=1;i++){const a=aim+i*.16,unparryable=!!e.wormShotUnparryable?.[i+1];api.bullet(g,e.x,e.y,Math.cos(a)*c.projectile,Math.sin(a)*c.projectile,10,'radWorm',false,unparryable,p.id,5);}e.wormShotUnparryable=undefined;api.event(g,'wormburst',e.x,e.y,'RADIATION BOLTS','',e.kind,'shoot');}
    else if(!e.l3Tell&&e.wormAttack<=0){e.angle=Math.atan2(p.y-e.y,p.x-e.x);e.wormWindupKick=.12;e.wormShotUnparryable=[api.random(g)<.22,api.random(g)<.22,api.random(g)<.22];announce(e,'wormCharge',.65);}
    else if(!e.l3Tell&&e.wormShotCd<=0){e.wormShotCd=3+api.random(g)*1.6;e.angle=Math.atan2(p.y-e.y,p.x-e.x);e.wormShotUnparryable=[api.random(g)<.22,api.random(g)<.22,api.random(g)<.22];announce(e,'wormBurst',.45);}
    if(e.l3Tell==='wormCharge'){
      const a=Math.atan2(p.y-e.y,p.x-e.x);
      if(e.wormWindupKick>0){e.wormWindupKick=Math.max(0,e.wormWindupKick-dt);e.aiVX=-Math.cos(a)*115;e.aiVY=-Math.sin(a)*115;}
      else{e.aiVX=0;e.aiVY=0;}
    }
    e.radTimer=Math.max(0,(e.radTimer??.7)-dt);if(e.radTimer<=0){e.radTimer=.85;const body=g.enemies.filter(q=>q.wormHeadId===e.id&&q.hp>0&&q.wormSegmentIndex),origin=body.length?body[Math.floor(api.random(g)*body.length)]:e,out=api.random(g)*TAU,speed=65+api.random(g)*265,h=api.hazard(g,origin.x,origin.y,48,2.7,8,'poisonCloud');h.source=e.id;h.vx=Math.cos(out)*speed;h.vy=Math.sin(out)*speed;h.cloudDrag=1.8+api.random(g)*2.4;}
    const body=g.enemies.filter(q=>q.wormHeadId===e.id&&q.wormSegmentIndex&&q.hp>0).sort((a,b)=>a.wormSegmentIndex-b.wormSegmentIndex);e.wormSegmentCount=body.length;e.wormInvulnerable=body.length>0;e.segmentCount=body.length;return true;
  }
  return false;
}
export function fireSpecial3(g,e){
  if(e.kind==='saw'||e.kind==='digger'||e.kind==='radWorm'||e.kind==='poisoner'||e.kind==='wallmaker'||e.kind==='sticky'||e.kind==='flamethrower')return true;
  return false;
}
export function specialHazard3(g,h,dt,alive,api){
  if(h.kind==='poisonCloud'){
    const speed=Math.hypot(h.vx||0,h.vy||0);
    if(speed>8){h.x+=(h.vx||0)*dt;h.y+=(h.vy||0)*dt;const drag=Math.exp(-(h.cloudDrag||2.6)*dt);h.vx*=drag;h.vy*=drag;}
    if(Math.hypot(h.vx||0,h.vy||0)<=8){h.vx=0;h.vy=0;}
    h.remaining-=dt;h.cloudHit??={};
    if(h.vx===0&&h.vy===0){
      if(h.owner){for(const e of g.enemies)if(e.hp>0&&!e.wormInvulnerable&&api.distance(e,h)<h.r+18&&g.time>=(h.cloudHit[e.id]||0)){h.cloudHit[e.id]=g.time+.45;e.hp-=h.damage;api.event(g,'hit',e.x,e.y,`${Math.round(h.damage)}`,h.owner);if(e.hp<=0)api.kill(g,e,g.players.find(p=>p.id===h.owner));}}
      else for(const p of alive)if(api.distance(p,h)<h.r+B.radius&&g.time>=(h.cloudHit[p.id]||0)){h.cloudHit[p.id]=g.time+.45;api.hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));}
    }
    return true;
  }
  if(h.kind==='potionProjectile'||h.kind==='stickyMine'||h.kind==='stickyAttached'){
    if(h.flight>0){
      if(h.kind==='stickyAttached'&&!h.returned){const target=g.enemies.find(e=>e.id===h.target&&e.hp>0);if(target){h.targetX=target.x;h.targetY=target.y;}}
      h.flight=Math.max(0,h.flight-dt);h.flightElapsed=Math.min(h.flightTotal||1,(h.flightElapsed||0)+dt);
      const t=Math.min(1,(h.flightElapsed||0)/(h.flightTotal||1));h.x=h.sx+(h.targetX-h.sx)*t;h.y=h.sy+(h.targetY-h.sy)*t;
      if(!h.returned&&h.flight>0&&h.flight<=.2){for(const p of alive){if(p.parryLeft<=0||api.distance(p,h)>B.radius+16)continue;const sourceAngle=Math.atan2(h.y-p.y,h.x-p.x),out=api.hitPlayer(g,p,0,true,sourceAngle,undefined,h.sourceKind);if(out!=='perfect'&&out!=='regular')continue;
          const sender=g.enemies.find(e=>e.id===h.source&&e.hp>0),oldKind=h.kind;h.returned=true;h.owner=p.id;h.kind=oldKind==='potionProjectile'?'potionProjectile':'stickyMine';h.sourceKind=oldKind==='potionProjectile'?'poisoner':'sticky';h.sx=h.x;h.sy=h.y;h.targetX=sender?.x??h.sx;h.targetY=sender?.y??h.sy;h.flight=.42;h.flightTotal=.42;h.flightElapsed=0;h.remaining=.42;h.total=.42;api.event(g,'reflect',p.x,p.y,'HAZARD RETURNED',p.id);return true;
        }}
      if(h.flight>0)return true;
      h.x=h.targetX;h.y=h.targetY;h.sx=undefined;h.sy=undefined;
      if(h.returned){
        if(h.kind==='potionProjectile'){const clouds=g.hazards.filter(q=>q.kind==='poisonCloud'&&q.source===h.source);if(clouds.length>=3){clouds.sort((a,b)=>a.remaining-b.remaining)[0].remaining=0;}const cloud=api.hazard(g,h.x,h.y,64,h.cloudDuration||4.2,h.damage,'poisonCloud');cloud.source=h.source;cloud.owner=h.owner;api.event(g,'toxin',h.x,h.y,'RETURNED TOXIN','',h.sourceKind,'impact');}
        else{api.event(g,'explosion',h.x,h.y,'RETURNED STICKY BLAST',h.owner,'sticky','impact').radius=h.r;for(const e of g.enemies)if(e.hp>0&&!e.wormInvulnerable&&api.distance(e,h)<h.r+18){e.hp-=h.damage;if(e.hp<=0)api.kill(g,e,g.players.find(p=>p.id===h.owner));}}
        h.done=true;h.remaining=-1;return true;
      }
      if(h.kind==='potionProjectile'){
        const clouds=g.hazards.filter(q=>q.kind==='poisonCloud'&&q.source===h.source);if(clouds.length>=3){clouds.sort((a,b)=>a.remaining-b.remaining)[0].remaining=0;}const cloud=api.hazard(g,h.x,h.y,64,h.cloudDuration||4.2,h.damage,'poisonCloud');cloud.source=h.source;api.event(g,'toxin',h.x,h.y,'TOXIC CLOUD','', 'poisoner','impact');h.done=true;h.remaining=-1;return true;
      }
      if(h.kind==='stickyMine'){h.remaining=3.4;h.total=3.4;api.event(g,'land',h.x,h.y,'STICKY MINE');return true;}
      h.remaining=h.attachDuration||5.5;h.total=h.remaining;return true;
    }
  }
  if(h.kind==='stickyAttached'){
    const target=g.enemies.find(e=>e.id===h.target&&e.hp>0);if(target){h.x=target.x;h.y=target.y;}const p=alive.find(q=>api.distance(q,h)<h.r+48);if(p){h.done=true;api.event(g,'explosion',h.x,h.y,'STICKY BLAST');api.hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));if(target){target.hp-=h.damage;if(target.hp<=0)api.kill(g,target,null);}h.remaining=-1;}return true;
  }
  if(h.kind==='stickyMine'){
    h.remaining-=dt;
    const p=alive.find(q=>api.distance(q,h)<h.r+B.radius);if(p||h.remaining<=0){if(p)api.hitPlayer(g,p,h.damage,false,Math.atan2(h.y-p.y,h.x-p.x));for(const e of g.enemies)if(e.hp>0&&!e.wormInvulnerable&&api.distance(e,h)<h.r+18){e.hp-=h.damage;if(e.hp<=0)api.kill(g,e,null);}h.done=true;h.remaining=-1;api.event(g,'explosion',h.x,h.y,'STICKY BLAST');}return true;
  }
  return false;
}
