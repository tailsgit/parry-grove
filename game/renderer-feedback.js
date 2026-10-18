import {FEEL,clamp,effectScale,impactProfile} from './feel-config.js';
import {COLORS} from './config.js';

const TAU=Math.PI*2;
const COUNTS={cluster:14,bounce:3,magnet:8,land:5,explosion:28,shieldbreak:16,enemyparry:10,block:5,kill:8,hit:5,dash:6,dashend:4};
const COLORS_BY_KIND={explosion:'#ffbf67',enemyparry:'#d7a2ff',shieldbreak:'#a6daff',block:'#a6daff',hurt:'#ff9b91',miss:'#e4b18d'};

export function processFeedback(r,e,g,me){
  if(e.kind==='miss'){if(e.who!==me||g.time-(r.lastMissAt??-10)<FEEL.missGap)return;r.lastMissAt=g.time;e={...e,text:'NO CONTACT',y:e.y-40};}
  const listener=g.players.find(p=>p.id===me),scale=effectScale(e,listener),profile=impactProfile(e),f=e.fx||{};
  const volume=scale*(e.kind==='swing'?.65:1);
  if(e.sourceKind&&e.weaponAction){if(!r.muted)r.enemyAudio?.play(e,listener,g.width);}
  else if(e.who===me||['kill','victory','clear','explosion','mortar','doorsopen','levelclear'].includes(e.kind))r.sound(e.kind==='kill'&&f.boss?'bossdeath':e.kind,volume);
  const interaction=r.addInteractionFeedback(e,g,scale),color=profile?.color||interaction?.color||COLORS_BY_KIND[e.kind]||'#fff1bc';
  const immune=e.kind==='hit'&&!(Number(e.text)>0);
  if(e.kind==='swing')r.feedback.swings.set(e.who,{angle:f.angle??g.players.find(p=>p.id===e.who)?.angle??0});
  if(e.kind==='reflect'&&f.bulletId!=null){if(r.feedback.reflections.size>=FEEL.reflections)r.feedback.reflections.delete(r.feedback.reflections.keys().next().value);r.feedback.reflections.set(f.bulletId,{life:.2});}
  if(e.kind==='kill')r.feedback.scrap(e);
  if(profile&&!immune){
    if(e.weaponAction==='melee'){const swing=r.feedback.swings.get(e.who);if(swing)swing.connected=true;}
    r.feedback.contact(e,profile,scale);
    const ring=r.addRing({...e,x:f.x??e.x,y:f.y??e.y});if(ring){ring.color=profile.color;ring.radius=profile.radius*(.65+.35*scale);ring.opacity=scale;ring.life=profile.duration;ring.max=profile.duration;}
    if(e.who===me)r.feedback.impulseAt(f.angle||0,profile.shake*Math.min(1.4,f.weight||1));
  }else if(e.kind==='hit'&&!immune){
    const target=g.enemies.find(target=>Math.hypot(target.x-e.x,target.y-e.y)<3);
    r.feedback.contact({...e,fx:{targetId:target?.id,angle:listener?Math.atan2(e.y-listener.y,e.x-listener.x):0}},FEEL.melee,scale*.65);
  }
  if(e.kind==='nova'){const ring=r.addRing(e);if(ring)ring.opacity=scale;}
  if(e.kind==='explosion'||e.kind==='kill'&&f.boss){
    const ring=r.addRing(e);if(ring){ring.color='#ffc578';ring.opacity=scale;ring.radius=Math.min(e.radius||70,140);ring.life=.5;ring.max=.5;}
    // A tiny bright core and bounded debris; the ground ring stays inside actual blast radius.
    r.feedback.contact(e,{color:'#fff0bd'},Math.min(1.5,scale));
    const distance=listener?Math.hypot(listener.x-e.x,listener.y-e.y):1000;
    if(distance<450)r.feedback.impulseAt(listener?Math.atan2(listener.y-e.y,listener.x-e.x):0,(f.boss?6:4)*(1-distance/500));
  }
  if(e.kind==='hurt'){r.feedback.react(e.who,listener?.angle||0,scale);if(e.who===me){r.feedback.impulseAt(listener?.angle||0,4);r.healthFlash=.12;}}
  if(e.kind==='perfect'&&e.who===me)r.perfectFlash=.24;
  let n=immune||interaction?0:profile?.count??COUNTS[e.kind]??0;
  if(f.boss)n=28;
  n=Math.ceil(n*scale*(r.reducedMotion?.35:1));
  for(let i=0;i<n;i++){
    const directional=!!profile||e.kind==='dash'||e.kind==='dashend';
    const angle=directional?(f.angle||0)+(e.kind==='dash'?Math.PI:0)+(Math.random()-.5)*1.2:Math.random()*TAU;
    const speed=(profile?80:35)+Math.random()*(profile?130:100);
    const particle=r.addParticle(f.x??e.x,f.y??e.y,Math.cos(angle)*speed,Math.sin(angle)*speed,color);
    if(particle&&profile){particle.life=.22;particle.max=.22;}
  }
  if(e.kind==='explosion')for(let i=0;i<Math.ceil(5*scale);i++)r.addParticle(e.x,e.y,(Math.random()-.5)*50,-20-Math.random()*30,'#807763');
  // The central DOM streak replaces the old second PERFECT label at the player.
  if(e.text&&e.kind!=='perfect'&&e.kind!=='upgrade'&&e.kind!=='kitpickup'&&!(e.kind==='kill'&&f.amount>0))r.addLabel(e,color);
}

export function drawGhosts(r,c,g,me){
  for(const ghost of r.feedback.ghosts){
    c.save();c.translate(Math.round(ghost.x),Math.round(ghost.y));
    c.globalAlpha=.28*ghost.life/ghost.max*(ghost.who===me?1:FEEL.teammateScale);
    c.fillStyle=COLORS[ghost.slot%4];c.fillRect(-10,-5,20,16);c.fillStyle='#d6f2d4';c.fillRect(-5,-16,13,12);c.fillStyle='#77d5b7';c.fillRect(-7,11,5,5);c.fillRect(3,11,5,5);c.restore();
  }
}

export function drawContacts(r,c){
  for(const f of r.feedback.contacts){
    c.save();c.translate(f.x,f.y);c.rotate(f.angle);c.globalAlpha=f.life/f.max*(r.reducedMotion?.35:1);
    const s=(.7+f.life/f.max*.6)*f.scale;c.scale(s,s);c.fillStyle=f.color;c.fillRect(-10,-2,20,4);c.fillRect(-2,-8,4,16);c.fillStyle='#ffffe9';c.fillRect(-4,-3,8,6);c.restore();
  }
}

export function drawReflections(r,c,g){
  for(const b of g.bullets){
    const flash=r.feedback.reflections.get(b.id);if(!flash||!b.owner)continue;
    c.save();c.translate(b.x,b.y);c.rotate(Math.atan2(b.vy,b.vx));c.globalAlpha=clamp(flash.life/.2,0,1)*.8;c.fillStyle='#afffe1';
    c.fillRect(-25,-2,19,4);c.beginPath();c.moveTo(8,0);c.lineTo(1,-6);c.lineTo(1,6);c.closePath();c.fill();c.fillStyle='#ffffdf';c.fillRect(-4,-3,8,6);c.restore();
  }
}

export function drawScrap(r,c,g){
  if(!g.runSystems)return;
  if(!r.scrapNode?.isConnected)r.scrapNode=r.canvas.parentElement?.querySelector('.scrap-count');
  const node=r.scrapNode;if(!node)return;
  const rect=node.getBoundingClientRect(),canvas=r.canvas.getBoundingClientRect(),tx=rect.left-canvas.left+9,ty=rect.top-canvas.top+rect.height/2;
  const camera=r.camera;
  for(const f of r.feedback.flights){
    const t=clamp(f.age/f.max,0,1),ease=1-(1-clamp((t-.12)/.88,0,1))**3;
    const sx=camera.ox+f.x*camera.scale,sy=camera.oy+f.y*camera.scale;
    const x=r.reducedMotion?tx:sx+(tx-sx)*ease,y=r.reducedMotion?ty:sy+(ty-sy)*ease-Math.sin(ease*Math.PI)*35;
    c.save();c.translate(Math.round(x),Math.round(y));c.globalAlpha=r.reducedMotion?1-t:.9;
    const size=1+Math.sin(Math.min(1,t/.16)*Math.PI)*.35;c.scale(size,size);c.fillStyle='#f0cf88';c.fillRect(-5,-5,10,10);c.fillStyle='#fff1b8';c.fillRect(-3,-3,3,3);c.strokeStyle='#f0cf88';c.lineWidth=1;c.beginPath();c.moveTo(-9,0);c.lineTo(-7,0);c.moveTo(7,0);c.lineTo(9,0);c.stroke();c.restore();
  }
  if(r.feedback.arrivals>r.lastScrapArrival){
    r.lastScrapArrival=r.feedback.arrivals;r.sound('pickup',.75);
    node.getAnimations?.().forEach(animation=>animation.cancel());
    node.animate?.(r.reducedMotion?[{opacity:.6},{opacity:1}]:[{transform:'scale(1)',color:'#fff9dc'},{transform:'scale(1.12)',color:'#fff9dc',offset:.3},{transform:'scale(1)',color:'#f0cf88'}],{duration:230,easing:'ease-out'});
  }
}
