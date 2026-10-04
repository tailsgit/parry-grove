import { ObjectPool, RectangleBatch, compact } from './performance.js';
import { COLORS, ENEMIES, WEAPONS, ROOM_THEMES, levelTheme, isBoss } from './config.js';
const SOUNDS={explosion:[70,.25,'sawtooth'],mortar:[180,.12,'triangle'],shieldbreak:[130,.25,'sawtooth'],enemyparry:[600,.13,'square'],perfect:[880,.16,'sine'],regular:[340,.09,'triangle'],block:[260,.06,'triangle'],hit:[170,.07,'square'],hurt:[110,.14,'sawtooth'],swing:[230,.04,'triangle'],dash:[440,.06,'sine'],kill:[540,.09,'square'],upgrade:[740,.18,'sine'],victory:[1000,.3,'sine'],guard:[500,.035,'sine'],miss:[180,.045,'triangle']};
const GLOBAL_SOUNDS=['kill','victory','clear','explosion','mortar'],RING_EVENTS=['perfect','regular','block','hit'];
const TAU=Math.PI*2;
export class Renderer {
  constructor(canvas) {this.canvas=canvas;this.ctx=canvas.getContext('2d');this.lastEvent=0;this.particles=[];this.labels=[];this.shake=0;this.audio=null;this.muted=false;this.camera={scale:1,ox:0,oy:0};this.lastRoom=-1;this.previousTime=-1;this.hitstop=0;this.perfectFlash=0;this.rings=[];this.entities=[];this.particlePool=new ObjectPool(()=>({}),2048);this.labelPool=new ObjectPool(()=>({}),128);this.ringPool=new ObjectPool(()=>({}),128);this.point={x:0,y:0};this.floorBatch=new RectangleBatch();this.floorStamp={};}
  unlockAudio() {if(!this.audio){const AC=window.AudioContext||window.webkitAudioContext;if(AC)this.audio=new AC();}this.audio?.resume();}
  sound(kind) {
    if(this.muted||!this.audio)return;
    const v=SOUNDS[kind];if(!v)return;const c=this.audio,o=c.createOscillator(),gain=c.createGain();o.type=v[2];o.frequency.setValueAtTime(v[0],c.currentTime);o.frequency.exponentialRampToValueAtTime(v[0]*(kind==='hurt'?.4:1.4),c.currentTime+v[1]);gain.gain.setValueAtTime(.045,c.currentTime);gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+v[1]);o.connect(gain);gain.connect(c.destination);o.start();o.stop(c.currentTime+v[1]);
  }
  world(x,y) {const r=this.canvas.getBoundingClientRect(),c=this.camera;this.point.x=(x-r.left-c.ox)/c.scale;this.point.y=(y-r.top-c.oy)/c.scale;return this.point;}
  draw(g,me,dt,attract=false) {
    if(this.hitstop>0){this.hitstop-=dt;return;}
    if(g.time<this.previousTime-.05){this.lastEvent=0;for(const p of this.particles)this.particlePool.release(p);for(const l of this.labels)this.labelPool.release(l);for(const r of this.rings)this.ringPool.release(r);this.particles.length=0;this.labels.length=0;this.shake=0;this.perfectFlash=0;this.rings.length=0;}this.previousTime=g.time;
    const c=this.ctx,canvas=this.canvas,r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.imageSmoothingEnabled=false;c.fillStyle='#173f38';c.fillRect(0,0,r.width,r.height);
    const scale=Math.min((r.width-24)/g.width,Math.max(220,r.height-190)/g.height),ox=(r.width-g.width*scale)/2,oy=105+(r.height-190-g.height*scale)/2;this.camera.scale=scale;this.camera.ox=ox;this.camera.oy=oy;
    this.shake=Math.max(0,this.shake-dt*28);
    c.save();c.translate(ox+(Math.random()-.5)*this.shake,oy+(Math.random()-.5)*this.shake);c.scale(scale,scale);
    this.theme=levelTheme(g);
    // Fractional transforms retain immediate-mode rasterization exactly. Only
    // integer device-pixel transforms can omit redundant opaque background tiles.
    this.drawFloor(g,c,this.shake===0&&Number.isInteger(scale*dpr)&&Number.isInteger(ox*dpr)&&Number.isInteger(oy*dpr));
    const overscan=(this.shake+2)/scale,minX=-ox/scale-overscan,minY=-oy/scale-overscan,maxX=(r.width-ox)/scale+overscan,maxY=(r.height-oy)/scale+overscan;
    for(const h of g.hazards){if(this.specialHazard(c,h))continue;if(h.kind==='beam'){c.save();c.strokeStyle='#ff294d';c.lineWidth=h.r*2;c.globalAlpha=.8;c.beginPath();c.moveTo(h.x,h.y);c.lineTo(h.ex,h.ey);c.stroke();c.strokeStyle='#fff1df';c.lineWidth=5;c.globalAlpha=1;c.stroke();c.restore();continue;}c.beginPath();c.arc(h.x,h.y,h.r,0,TAU);c.fillStyle=h.remaining<=0?'#fff1a9aa':'#ff294d44';c.fill();c.strokeStyle='#ff294d';c.lineWidth=3;c.setLineDash([6,6]);c.stroke();c.setLineDash([]);c.beginPath();c.arc(h.x,h.y,h.r, -Math.PI/2,-Math.PI/2+TAU*Math.min(1,Math.max(0,1-h.remaining/Math.max(.001,h.total))));c.strokeStyle='#ffedb2';c.stroke();c.fillStyle='#641020';c.font='bold 14px monospace';c.textAlign='center';c.fillText(h.dashOnly?'DASH AT DETONATION':h.kind==='shockwave'?'BACK OFF · BLOCK':'BLOCK / DODGE',h.x,h.y+4);}
    for(const h of g.hazards)if(h.sx!=null&&h.remaining>0){
      const t=1-h.remaining/h.total,x=h.sx+(h.x-h.sx)*t,y=h.sy+(h.y-h.sy)*t-Math.sin(t*Math.PI)*95;
      c.fillStyle='#413e3866';c.fillRect(h.sx+(h.x-h.sx)*t-4,h.sy+(h.y-h.sy)*t,8,4);
      c.fillStyle='#ffe8aa';c.fillRect(x-4,y-5,8,10);c.fillStyle='#ff9254';c.fillRect(x-3,y+6,6,8);
    }
    for(const o of g.obstacles)this.cover(c,o);
    const entities=this.entities;entities.length=0;for(const e of g.enemies)entities.push(e);for(const p of g.players)entities.push(p);entities.sort(depthOrder);
    for(const e of entities) {
      if(e.kind)this.enemy(c,e);else this.hero(c,e,g,e.id===me,attract);
    }
    for(const b of g.bullets){const extent=16+(b.radius||3);if(b.x+extent<minX||b.x-extent>maxX||b.y+extent<minY||b.y-extent>maxY)continue;const friendly=!!b.owner;c.save();c.translate(b.x,b.y);c.rotate(Math.atan2(b.vy,b.vx));c.fillStyle=friendly?'#c2ffe5':b.unparryable?'#ff294d':ENEMIES[b.kind]?.color||'#ffe69a';const thickness=b.radius||3;if(b.kind==='magnet'){c.beginPath();c.moveTo(12,0);c.lineTo(-6,-5);c.lineTo(-2,0);c.lineTo(-6,5);c.closePath();c.fill();}else if(b.thrower){c.strokeStyle='#ffd2eb';c.lineWidth=5;c.beginPath();c.arc(-4,0,12,-1.2,1.2);c.stroke();}else c.fillRect(-7,-thickness,14,thickness*2);if(b.ricochet){c.strokeStyle='#f3a36b';c.lineWidth=2;c.strokeRect(-9,-thickness-2,18,thickness*2+4);}if(b.wave){c.fillStyle='#c1a6f288';for(let i=1;i<4;i++)c.fillRect(-7-i*6,Math.sin((b.waveAge||0)*8-i*.3)*4-2,4,4);}c.fillStyle=friendly?'#63d8ad':b.unparryable?'#fff0f2':'#fff3c8';if(b.unparryable){c.strokeStyle='#ff294d';c.lineWidth=2;c.strokeRect(-10,-thickness-3,20,thickness*2+6);}c.fillRect(0,-Math.max(2,thickness-1),7,Math.max(4,thickness*2-2));c.restore();}
    if(!attract)for(const e of g.events)if(e.id>this.lastEvent) {
      this.lastEvent=e.id;if(g.time-e.time>.7)continue;
      if(e.who===me||GLOBAL_SOUNDS.includes(e.kind))this.sound(e.kind);
      if(RING_EVENTS.includes(e.kind))this.addRing(e);
      const col=e.kind==='explosion'?'#ffbf67':e.kind==='enemyparry'?'#d7a2ff':e.kind==='shieldbreak'?'#a6daff':e.kind==='perfect'?'#b8ffaf':e.kind==='regular'?'#ffbc65':e.kind==='block'?'#a6daff':e.kind==='hurt'?'#ff9b91':e.kind==='miss'?'#e4b18d':'#fff1bc';
      const n=e.kind==='cluster'?24:e.kind==='bounce'?4:e.kind==='magnet'?16:e.kind==='land'?8:e.kind==='explosion'?48:e.kind==='shieldbreak'?30:e.kind==='enemyparry'?20:e.kind==='perfect'?36:e.kind==='regular'?20:e.kind==='block'?10:e.kind==='guard'?8:e.kind==='swing'?6:e.kind==='kill'?18:e.kind==='hit'?12:e.kind==='dash'?8:0;
      for(let i=0;i<n;i++){const a=Math.random()*TAU,s=40+Math.random()*150;this.addParticle(e.x,e.y,Math.cos(a)*s,Math.sin(a)*s,col);}
      if(e.text)this.addLabel(e,col);
      if(e.kind==='explosion'){const p=g.players.find(p=>p.id===me);if(p)this.shake=Math.max(this.shake,Math.max(0,9-Math.hypot(p.x-e.x,p.y-e.y)/45));}
      if(e.who===me){if(e.kind==='shieldbreak'||e.kind==='enemyparry')this.shake=Math.max(this.shake,6);if(e.kind==='swing')this.shake=Math.max(this.shake,1.5);if(e.kind==='hit'){this.shake=Math.max(this.shake,3);this.hitstop=.02;}if(e.kind==='regular')this.shake=Math.max(this.shake,4);if(e.kind==='block')this.shake=Math.max(this.shake,2);if(e.kind==='hurt')this.shake=7;if(e.kind==='perfect'){this.shake=6;this.hitstop=.035;this.perfectFlash=.24;}}
    }
    for(const ring of this.rings){ring.life-=dt;const progress=1-ring.life/.28;c.save();c.globalAlpha=Math.max(0,1-progress);c.strokeStyle=ring.kind==='perfect'?'#b8ffaf':ring.kind==='regular'?'#ffbc65':ring.kind==='block'?'#a6daff':'#fff5d4';c.lineWidth=ring.kind==='perfect'?5:3;c.beginPath();c.arc(ring.x,ring.y,12+progress*(ring.kind==='perfect'?65:34),0,TAU);c.stroke();if(ring.kind==='hit'){c.beginPath();c.moveTo(ring.x-10,ring.y-10);c.lineTo(ring.x+10,ring.y+10);c.moveTo(ring.x+10,ring.y-10);c.lineTo(ring.x-10,ring.y+10);c.stroke();}c.restore();}compact(this.rings,aliveEffect,this.ringPool);
    for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;c.globalAlpha=Math.max(0,p.life/p.max);if(p.x+3>=minX&&p.x-3<=maxX&&p.y+3>=minY&&p.y-3<=maxY){c.fillStyle=p.color;c.fillRect(p.x-2,p.y-2,4,4);}}c.globalAlpha=1;compact(this.particles,aliveEffect,this.particlePool);
    for(const l of this.labels){l.life-=dt;l.y-=dt*28;c.globalAlpha=Math.min(1,Math.max(0,l.life*3));c.font=`bold ${l.large?19:14}px monospace`;c.textAlign='center';c.fillStyle='#173f38';c.fillText(l.text,l.x+1,l.y+2);c.fillStyle=l.color;c.fillText(l.text,l.x,l.y);}c.globalAlpha=1;compact(this.labels,aliveEffect,this.labelPool);
    if(g.intro>0&&!attract){c.textAlign='center';c.font='bold 24px monospace';c.fillStyle='#14362de0';c.fillRect(g.width/2-185,55,370,58);c.fillStyle='#fff2bd';c.fillText(this.theme.name.toUpperCase(),g.width/2,91);}
    if(g.phase==='upgrade'){const x=g.width-95,y=g.height/2;c.fillStyle='#a7ffe0';c.fillRect(x-20,y-30,40,60);c.fillStyle='#2b6b56';c.fillRect(x-12,y-20,24,40);c.font='bold 12px monospace';c.textAlign='center';c.fillStyle='#fbf4cb';c.fillText('E · NEXT ROOM',x,y+49);}
    c.restore();
    // Screen-space feedback stays pinned to the edges, independent of camera shake.
    if(this.perfectFlash>0&&!attract){
      const alpha=this.perfectFlash/.24,edge=Math.min(r.width,r.height)*.15;
      c.save();c.globalAlpha=alpha*.8;
      for(const [x1,y1,x2,y2,x,y,w,h] of [
        [0,0,edge,0,0,0,edge,r.height],
        [r.width,0,r.width-edge,0,r.width-edge,0,edge,r.height],
        [0,0,0,edge,0,0,r.width,edge],
        [0,r.height,0,r.height-edge,0,r.height-edge,r.width,edge]
      ]){const glow=c.createLinearGradient(x1,y1,x2,y2);glow.addColorStop(0,'#55ff83');glow.addColorStop(1,'#55ff8300');c.fillStyle=glow;c.fillRect(x,y,w,h);}
      c.restore();this.perfectFlash=Math.max(0,this.perfectFlash-dt);
    }
  }
  specialHazard(c,h){
    if(!['mine','cluster','grenade'].includes(h.kind))return false;
    c.save();c.translate(h.x,h.y);c.strokeStyle='#ff758f';c.lineWidth=2;
    if(h.kind==='mine'){c.globalAlpha=.3;c.setLineDash([3,6]);c.beginPath();c.arc(0,0,h.triggerRadius,0,TAU);c.stroke();c.setLineDash([]);c.globalAlpha=1;c.fillStyle='#493d38';c.beginPath();c.arc(0,0,11,0,TAU);c.fill();c.stroke();c.fillStyle=h.armed?'#ff294d':'#e3c476';c.fillRect(-3,-3,6,6);}
    else{c.globalAlpha=.35;c.beginPath();c.arc(0,0,h.r,0,TAU);c.fillStyle='#ff294d';c.fill();c.globalAlpha=1;c.stroke();if(!h.flight){c.fillStyle='#e3c476';c.fillRect(-7,-8,14,16);c.fillStyle='#ff294d';c.fillRect(-2,-11,4,5);if(h.kind==='cluster'){for(let i=0;i<5;i++){const a=i*TAU/5;c.beginPath();c.moveTo(Math.cos(a)*13,Math.sin(a)*13);c.lineTo(Math.cos(a)*24,Math.sin(a)*24);c.stroke();}}}}
    c.restore();return true;
  }
  addParticle(x,y,vx,vy,color){const p=this.particlePool.acquire();p.x=x;p.y=y;p.vx=vx;p.vy=vy;p.life=.45;p.max=.45;p.color=color;this.particles.push(p);}
  addLabel(e,color){const l=this.labelPool.acquire();l.x=e.x;l.y=e.y-25;l.text=e.text;l.life=.9;l.color=color;l.large=e.kind==='perfect';this.labels.push(l);}
  addRing(e){const r=this.ringPool.acquire();r.x=e.x;r.y=e.y;r.kind=e.kind;r.life=.28;this.rings.push(r);}
  drawFloor(g,c,aligned){
    const stamp=this.floorStamp,batch=this.floorBatch,scenerySeed=g.scenerySeed??g.room;
    if(stamp.seed!==scenerySeed||stamp.stage!==(g.stage??0)||stamp.width!==g.width||stamp.height!==g.height||stamp.aligned!==aligned){
      batch.count=0;this.floor(g,batch,aligned);stamp.seed=scenerySeed;stamp.stage=g.stage??0;stamp.width=g.width;stamp.height=g.height;stamp.aligned=aligned;
    }
    batch.replay(c);
  }
  floor(g,c,aligned=false) {
    const t=this.theme||ROOM_THEMES[0];c.fillStyle=t.floor[0];c.fillRect(0,0,g.width,g.height);
    for(let y=32;y<g.height-32;y+=32)for(let x=32;x<g.width-32;x+=32){
      const n=((x*73+y*97+(g.scenerySeed??g.room))%19);if(!aligned||n%3!==0){c.fillStyle=t.floor[n%3];c.fillRect(x,y,32,32);}
      c.fillStyle=t.detail;
      if(t.scenery==='flowers'&&n%4===0){c.fillRect(x+8,y+11,3,7);if(n%2===0){c.fillStyle='#f5d6ae';c.fillRect(x+6,y+9,7,4);}}
      if(t.scenery==='leaves'&&n<7){c.fillRect(x+8,y+15,7,4);c.fillStyle='#d17b48';c.fillRect(x+19,y+7,5,3);}
      if(t.scenery==='tiles'){c.fillStyle='#657d7766';c.fillRect(x,y,30,1);c.fillRect(x,y,1,30);if(n===8)c.fillRect(x+8,y+12,16,2);}
      if(t.scenery==='water'&&n<8){c.fillStyle='#305866';c.fillRect(x+2,y+9,27,15);c.fillStyle='#82bdc6';c.fillRect(x+8,y+13,13,2);c.fillStyle='#78a998';c.fillRect(x+23,y+6,2,9);}
      if(t.scenery==='forge'){c.fillStyle='#493d38';c.fillRect(x,y+27,32,3);if(n<4){c.fillStyle='#e3954c';c.fillRect(x+9,y+12,4,4);}}
    }
    c.fillStyle=t.border;c.fillRect(15,15,g.width-30,18);c.fillRect(15,g.height-33,g.width-30,18);c.fillRect(15,15,18,g.height-30);c.fillRect(g.width-33,15,18,g.height-30);
    c.fillStyle=t.edge;c.fillRect(0,0,g.width,13);c.fillRect(0,g.height-13,g.width,13);c.fillRect(0,0,13,g.height);c.fillRect(g.width-13,0,13,g.height);
    for(let x=2;x<g.width;x+=26){c.fillStyle=t.detail;c.fillRect(x,2,17,5);c.fillRect(x,g.height-8,17,5);}
  }
  cover(c,o){c.fillStyle='#244c3c44';c.fillRect(o.x+7,o.y+12,o.w,o.h);c.fillStyle='#837c63';c.fillRect(o.x,o.y+8,o.w,o.h-5);c.fillStyle=this.theme?.stone||'#bab793';c.fillRect(o.x,o.y,o.w,o.h-5);c.fillStyle=this.theme?.highlight||'#d7d1a9';c.fillRect(o.x+4,o.y+4,o.w-8,6);c.fillStyle='#7f986a';c.fillRect(o.x+5,o.y+17,12,6);c.fillRect(o.x+o.w-19,o.y+24,14,7);}
  hero(c,p,g,isMe,attract){const color=COLORS[p.slot%4];c.save();c.translate(Math.round(p.x),Math.round(p.y));
    c.fillStyle='#294b3a66';c.beginPath();c.ellipse(0,12,15,6,0,0,TAU);c.fill();
    if(p.hp<=0){c.fillStyle=color;c.fillRect(-10,1,20,7);c.fillStyle='#f3dfba';c.fillRect(6,-1,8,8);c.restore();return;}
    if(p.invuln>0&&Math.floor(g.time*15)%2)c.globalAlpha=.5;
    if(isMe){c.strokeStyle='#d4ffcc99';c.lineWidth=1.5;c.beginPath();c.ellipse(0,12,18,8,0,0,TAU);c.stroke();}
    if(p.dashLeft>0){c.fillStyle=color+'55';for(let i=1;i<4;i++)c.fillRect(-p.dx*i*12-7,-p.dy*i*12-5,14,19);}
    const bob=attract?Math.sin(g.time*3)*1:Math.sin(g.time*13)*1;c.fillStyle='#264b3f';c.fillRect(-8,8+bob,6,7);c.fillRect(3,8-bob,6,7);c.fillStyle=color;c.fillRect(-10,-5,20,16);c.fillStyle='#eef1ce';c.fillRect(-5,-16,13,12);c.fillStyle='#263e35';c.fillRect(-7,-19,17,6);c.fillRect(-7,-16,4,9);c.fillRect(p.angle>Math.PI/2||p.angle<-Math.PI/2?-3:5,-11,2,2);c.fillStyle='#f7d685';c.fillRect(-10,3,20,3);
    c.save();c.rotate(p.angle+(p.swing>0?(-WEAPONS[p.weapon].arc/2+WEAPONS[p.weapon].arc*(1-p.swing/.15)):0));c.fillStyle='#fff1ca';c.fillRect(9,-3,7,6);c.fillStyle='#e4eee1';const len=p.weapon==='dagger'?17:p.weapon==='sword'?28:39;c.fillRect(17,-2,len,4);c.fillStyle='#d9b96d';c.fillRect(16,-6,4,12);c.restore();
    if(p.swing>0){const w=WEAPONS[p.weapon],progress=1-p.swing/.15;c.save();c.globalAlpha=p.swing/.15;c.strokeStyle='#fff8d9';c.lineWidth=9;c.beginPath();c.arc(0,0,w.range,p.angle-w.arc/2,p.angle-w.arc/2+w.arc*Math.min(1,progress+.3));c.stroke();c.strokeStyle='#e9c26c';c.lineWidth=3;c.beginPath();c.arc(0,0,w.range-9,p.angle-w.arc/2,p.angle+w.arc/2);c.stroke();c.restore();}
    if(p.magnetLeft>0){c.strokeStyle='#77d9ed';c.lineWidth=3;c.beginPath();c.arc(0,0,21,-.6,Math.PI+.6);c.stroke();c.fillStyle='#77d9ed';c.fillRect(-23,-3,7,9);c.fillRect(16,-3,7,9);}
    if(p.stun>0){c.fillStyle='#d7a2ff';c.font='bold 15px monospace';c.textAlign='center';c.fillText('✦ ✦ ✦',0,-43);}
    if(p.blocking){c.strokeStyle='#a6daff';c.lineWidth=5;c.beginPath();c.arc(0,0,29,p.angle-1.6,p.angle+1.6);c.stroke();}
    if(p.parryLeft>0){const perfect=p.parryAge<=p.perfect;c.strokeStyle=perfect?'#b4ffab':'#ffbe69';c.lineWidth=perfect?6:4;c.beginPath();c.arc(0,0,27,p.angle-1.6,p.angle+1.6);c.stroke();}
    c.globalAlpha=1;c.fillStyle=color;c.font='bold 11px monospace';c.textAlign='center';if(!attract)c.fillText(p.name,0,-29);c.restore();
  }
  enemy(c,e){const cfg=ENEMIES[e.kind],boss=isBoss(e.kind);c.save();c.translate(Math.round(e.x),Math.round(e.y));const s=boss?1.8:1;c.scale(s,s);c.fillStyle='#294b3a66';c.beginPath();c.ellipse(0,13,16,6,0,0,TAU);c.fill();c.fillStyle='#5a5148';c.fillRect(-10,7,7,9);c.fillRect(4,7,7,9);c.fillStyle=cfg.color;c.fillRect(-12,-5,24,16);c.fillStyle='#f6e0b6';c.fillRect(-8,-17,16,13);c.fillStyle='#574d42';c.fillRect(-10,-19,20,7);c.fillRect(-7,-10,14,3);c.fillStyle='#fff2d3';c.fillRect(-5,-10,3,2);c.fillRect(3,-10,3,2);this.weapon(c,e,cfg);
    if(e.kind==='miner'){c.fillStyle='#dec17a';c.font='bold 10px monospace';c.textAlign='center';c.fillText(e.mineState==='hold'?`HOLD ${(e.mineTimer||0).toFixed(1)}s`:e.mineState==='flee'?'FLEE':'APPROACH',0,-31);}
    if(e.kind==='suicide'&&e.primed){c.save();c.strokeStyle='#ff294d';c.lineWidth=3;c.globalAlpha=.5;c.beginPath();c.arc(0,0,260,0,TAU);c.stroke();c.globalAlpha=1;c.fillStyle='#ff294d';c.font='bold 12px monospace';c.textAlign='center';c.fillText('DASH ONLY',0,-48);c.restore();}
    if(boss&&e.repositionLeft>0){c.fillStyle='#ffce7255';for(let i=1;i<4;i++)c.fillRect(-e.repositionX*i*10-10,-e.repositionY*i*10-6,20,20);}
    if(e.kind==='railgun'&&e.tell>0){c.save();c.rotate(e.angle);c.strokeStyle='#ff294d';c.globalAlpha=.55;c.lineWidth=2;c.setLineDash([8,8]);c.beginPath();c.moveTo(25,0);c.lineTo(1200,0);c.stroke();c.restore();}
    if(e.tell>0&&cfg.melee&&e.action!=='parry'){c.save();c.fillStyle='#ffe4bb22';c.strokeStyle='#ffe4bb99';c.lineWidth=1;c.beginPath();c.moveTo(0,0);c.arc(0,0,cfg.range,e.angle-cfg.arc/2,e.angle+cfg.arc/2);c.closePath();c.fill();c.stroke();c.restore();}
    if(e.swing>0&&cfg.melee){c.strokeStyle='#ffe4bb';c.lineWidth=6;c.beginPath();c.arc(0,0,cfg.range,e.angle-cfg.arc/2,e.angle+cfg.arc/2);c.stroke();}
    if(e.guardLeft>0){c.strokeStyle='#d49aff';c.lineWidth=5;c.beginPath();c.arc(0,0,28,e.angle-1.6,e.angle+1.6);c.stroke();}
    if(e.stun>0){c.fillStyle='#c8efff';c.font='bold 12px monospace';c.textAlign='center';c.fillText('STUNNED',0,-30);}
    if(e.tell>0){c.strokeStyle=e.action==='parry'?'#d49aff':e.danger||e.primed?'#ff294d':'#fff0b1';c.lineWidth=2;c.beginPath();c.arc(0,0,23,0,TAU*(1-e.tell/(e.tellTotal||(e.danger&&e.kind!=='railgun'?Math.max(.8,cfg.tell):cfg.tell))));c.stroke();c.fillStyle=e.action==='parry'?'#d49aff':e.danger?'#ff294d':'#fff2af';c.font=`bold ${e.danger?14:17}px monospace`;c.textAlign='center';if(e.danger){c.fillStyle='#591426';c.fillRect(-31,-41,62,18);c.fillStyle='#ff758f';}c.fillText(e.action==='parry'?'PARRY':e.danger?'DANGER!':'!',0,-27);}
    c.fillStyle='#244637';c.fillRect(-18,21,36,4);c.fillStyle=cfg.color;c.fillRect(-18,21,36*Math.max(0,e.hp/e.maxHp),4);c.restore();
  }
  weapon(c,e,cfg){
    c.save();const swing=cfg.melee&&e.swing>0?cfg.arc*(.5-e.swing/.2):0;c.rotate(e.angle+swing);c.translate(-(e.recoil||0)*14,0);c.fillStyle='#453e3a';
    if(e.kind==='bow'){c.strokeStyle='#e2b273';c.lineWidth=3;c.beginPath();c.arc(15,0,16,-1.15,1.15);c.stroke();c.strokeStyle='#f5ebc9';c.lineWidth=1;c.beginPath();c.moveTo(21,-15);c.lineTo(e.tell>0?10:21,0);c.lineTo(21,15);c.stroke();c.fillRect(9,-1,28,2);}
    else if(e.kind==='pistol'){c.fillRect(10,-5,22,9);c.fillRect(12,2,7,12);c.fillStyle='#b6b9ac';c.fillRect(27,-4,7,6);}
    else if(e.kind==='shotgun'){c.fillRect(7,-5,13,12);c.fillRect(18,-6,30,4);c.fillRect(18,2,30,4);c.fillStyle='#be986a';c.fillRect(23,-2,12,4);c.fillRect(8,6,6,7);}
    else if(e.kind==='homing'){c.fillRect(8,-9,28,18);c.fillStyle='#9897bb';c.fillRect(32,-7,7,14);c.fillStyle='#e7c4ff';c.fillRect(15,-5,7,10);c.strokeStyle='#c9b0ee';c.lineWidth=2;c.strokeRect(11,-12,22,24);}
    else if(e.kind==='mortar'){c.fillRect(6,8,25,5);c.save();c.rotate(-.6);c.fillStyle='#697f86';c.fillRect(12,-7,25,14);c.fillStyle='#263a44';c.fillRect(33,-8,6,16);c.restore();}
    else if(e.kind==='railgun'){c.fillRect(7,-7,15,14);c.fillStyle='#adb9c1';c.fillRect(17,-8,38,4);c.fillRect(17,4,38,4);c.fillStyle='#ef86ad';for(let x=23;x<50;x+=8)c.fillRect(x,-10,3,20);}
    else if(e.kind==='boss'){c.fillRect(6,-10,16,20);c.fillStyle='#9c9580';for(let y=-8;y<=8;y+=8)c.fillRect(21,y,27,5);c.fillStyle='#ecc77a';c.fillRect(17,-13,7,26);}
    else if(e.kind==='miner'){c.fillStyle='#655139';c.fillRect(-17,-8,13,20);c.fillStyle='#dec17a';for(let i=0;i<3;i++){c.beginPath();c.arc(-10,-4+i*6,3,0,TAU);c.fill();}}
    else if(e.kind==='suicide'){c.fillStyle='#ff7868';c.fillRect(-9,-5,18,13);c.fillStyle=e.primed?'#fff2af':'#453e3a';c.fillRect(-7,-2,4,7);c.fillRect(3,-2,4,7);c.strokeStyle='#e9c97a';c.lineWidth=2;c.beginPath();c.moveTo(0,-5);c.lineTo(5,-12);c.stroke();}
    else if(e.kind==='riot'){c.fillStyle=e.stun>0?'#65727a':'#d2dde0';c.fillRect(14,-22,10,44);c.fillStyle='#45586a';c.fillRect(17,-19,5,38);c.fillStyle='#b6e1ef';c.fillRect(17,-13,5,10);c.fillStyle='#e8c66a';c.fillRect(17,4,5,4);}
    else if(e.kind==='boomerang'){c.strokeStyle='#e9a7c4';c.lineWidth=6;c.beginPath();c.arc(16,0,14,-1.25,1.25);c.stroke();}
    else if(e.kind==='cluster'||e.kind==='twinBomber'){c.fillRect(8,-10,28,20);c.fillStyle='#728268';c.fillRect(13,-7,19,14);c.fillStyle='#202b28';c.beginPath();c.arc(34,0,8,0,TAU);c.fill();c.fillStyle='#e3c476';c.fillRect(16,9,6,9);if(e.kind==='twinBomber'){c.fillStyle='#f39e67';c.fillRect(8,-14,24,4);c.fillRect(8,10,24,4);}}
    else if(e.kind==='magnet'){c.fillRect(8,-5,24,10);c.strokeStyle='#77d9ed';c.lineWidth=4;c.beginPath();c.arc(24,0,12,.6,TAU-.6);c.stroke();c.fillStyle='#dff8fc';c.fillRect(30,-9,7,5);c.fillRect(30,4,7,5);}
    else if(e.kind==='sine'){c.fillRect(8,-7,27,14);c.strokeStyle='#c1a6f2';c.lineWidth=3;c.beginPath();for(let x=11;x<37;x++){const y=Math.sin((x-11)*.4)*5;if(x===11)c.moveTo(x,y);else c.lineTo(x,y);}c.stroke();}
    else if(e.kind==='ricochet'||e.kind==='twinRicochet'){c.fillRect(8,-6,29,12);c.fillStyle='#b4b79e';c.fillRect(27,-8,11,16);c.strokeStyle='#ffcb7b';c.lineWidth=2;c.beginPath();c.moveTo(12,-3);c.lineTo(19,3);c.lineTo(26,-3);c.stroke();if(e.kind==='twinRicochet'){c.fillRect(32,-13,10,6);c.fillRect(32,7,10,6);}}
    else if(e.kind==='lancer'){c.fillStyle='#a77b50';c.fillRect(7,-2,44,4);c.fillStyle='#e9edf0';c.beginPath();c.moveTo(60,0);c.lineTo(45,-6);c.lineTo(45,6);c.closePath();c.fill();}
    else {c.fillStyle='#c29558';c.fillRect(7,-2,28,4);c.fillStyle='#d7ddd6';c.fillRect(29,-10,12,20);c.fillStyle='#f3ead2';c.fillRect(37,-10,4,20);}
    if(e.recoil>0&&!cfg.melee&&e.kind!=='bow'){const x=e.kind==='railgun'?56:e.kind==='shotgun'?49:e.kind==='boss'?49:38;c.fillStyle=e.danger?'#ff6780':'#ffe6a5';c.globalAlpha=e.recoil/.24;c.beginPath();c.moveTo(x,0);c.lineTo(x+14,-7);c.lineTo(x+10,0);c.lineTo(x+14,7);c.closePath();c.fill();}
    c.restore();
  }

}

const depthOrder=(a,b)=>a.y-b.y;
const aliveEffect=e=>e.life>0;
