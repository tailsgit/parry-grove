'use client';
import {useEffect,useRef,useState} from 'react';
import {BALANCE} from './config.js';
import {SoloHitPause} from './hit-pause.js';
import {Renderer} from './renderer.js';
import {createGame,player,spawnEnemy,hitPlayer} from './engine.js';
import {mouseButton,guardButton,resetGuard} from './input.js';
import {PlayerHud,PerfectParryHud} from './CombatHud.jsx';
export const LESSONS=[
 ['Find your feet','Move with WASD or arrows. Mouse aims your blade.','move'],
 ['Meet your blade','Aim at the training partner and hold left click to land a melee hit.','hit'],
 ['Step through danger','Press Space to dash. Your normal dash activates immediately.','dash'],
 ['Perfect timing','Face right. Tap Q / right click just before the charge ring closes. Green means perfect. Release before another try.','perfect'],
 ['A regular parry','Tap slightly earlier: after the green window, your guard turns orange. Regular parries chip HP and store amber internal damage.','regular'],
 ['Hold your ground','Keep Q / right click held beyond the orange window. Blue blocks spend shield and reduce HP damage by 80%.','block'],
 ['Clear the pressure','Melee clears 2 internal damage per hit; Sword perfects clear 8. No passive recovery. An unguarded hit releases the meter. Internal persists across rooms, clearing at the next area.','hit'],
 ['Keep the rhythm','Each perfect refreshes a three-second streak timer. Only actual HP damage or timer expiry resets it. Attacks and dashes preserve it. Earn one more perfect to finish.','perfect'],
];
// Separate disposable solo world. Real combat functions, no run rewards or network.
export default function Tutorial({onFinish,preferences}){
 const canvas=useRef(null),controller=useRef(null),[lesson,setLesson]=useState(0),lessonRef=useRef(0),[sample,setSample]=useState(null),[success,setSuccess]=useState(false),[message,setMessage]=useState(''),done=useRef(false);
 function advance(){if(lesson===LESSONS.length-1){localStorage.setItem('parry-grove-practice','complete');onFinish();return;}const next=lesson+1;lessonRef.current=next;setLesson(next);done.current=false;setSuccess(false);setMessage('');controller.current?.reset();canvas.current?.focus();}
 useEffect(()=>{
  const p=player('practice','You','sword'),g=createGame([p],193);g.practiceWorld=true;g.obstacles=[];g.enemies=[];g.bullets=[];g.hazards=[];g.intro=1e6;p.x=380;p.y=310;p.angle=0;
  const partner=spawnEnemy(g,'brawler',435,310);partner.cooldown=1e6;partner.hp=partner.maxHp=1e6;partner.angle=Math.PI;
  const r=new Renderer(canvas.current);r.observeMotion();r.setPreferences(preferences);
  const pause=new SoloHitPause();const i={mx:0,my:0,angle:0,attack:false,guard:false,parry:0,dash:0,attackPress:0},keys=new Set();let cycle=0,last=performance.now(),frame,hud=0,serial=0;
  controller.current={reset(){cycle=0;p.x=380;p.y=310;partner.x=435;partner.y=310;resetGuard(i);i.attack=false;p.invuln=0;p.hp=p.maxHp;p.shieldDamage=0;p.shieldBroken=false;}};
  const down=e=>{if(['INPUT','BUTTON'].includes(e.target.tagName))return;const k=e.key.toLowerCase();if([' ','q','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();keys.add(k);if(e.repeat)return;r.unlockAudio();if(k===' ')i.dash++;if(k==='q')guardButton(i,'keyboard',true);};
  const up=e=>{keys.delete(e.key.toLowerCase());if(e.key.toLowerCase()==='q')guardButton(i,'keyboard',false);};const blur=()=>{keys.clear();i.attack=false;resetGuard(i);last=performance.now();};
  const press=e=>{r.unlockAudio();mouseButton(i,e.button,true);};const release=e=>mouseButton(i,e.button,false);const aim=e=>{const v=r.world(e.clientX,e.clientY);i.angle=Math.atan2(v.y-p.y,v.x-p.x);};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('mouseup',release);window.addEventListener('blur',blur);
  const element=canvas.current;element.addEventListener('mousedown',press);element.addEventListener('mousemove',aim);element.focus();
  const tick=now=>{const dt=document.hidden?0:Math.min(.035,(now-last)/1000);last=now;
   i.mx=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);i.my=(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);
   partner.tell=0;const simulated=pause.advance(g,{practice:i},dt,p.id);g.phase='combat';g.intro=1e6;p.hp=Math.max(1,p.hp);partner.hp=partner.maxHp;partner.stun=0;partner.cooldown=1e6;
   const n=lessonRef.current;
   if(n>=3){cycle+=simulated;partner.x=p.x+55;partner.y=p.y;partner.angle=Math.PI;partner.tellTotal=1.1;partner.tell=cycle>1.4?Math.max(.001,2.5-cycle):0;if(cycle>=2.5){const outcome=hitPlayer(g,p,12,true,0,partner);if(outcome==='perfect')pause.remaining=BALANCE.soloPerfectHitPause;setMessage(outcome==='hurt'?'Contact: HP damage. Face right and watch the ring.':outcome==='immune'?'Avoided. Try guarding the next contact.':outcome==='perfect'?'Perfect · green!':outcome==='regular'?'Regular · orange. Internal damage accumulated.':'Held block · blue. Shield spent.');cycle=0;p.hp=Math.max(1,p.hp);}}
   if(n===0&&(i.mx||i.my)&&!done.current){done.current=true;setSuccess(true);}
   for(const e of g.events)if(e.id>serial&&e.who===p.id&&e.kind===LESSONS[n][2]&&!done.current){done.current=true;setSuccess(true);}serial=g.eventSerial;
   if(p.hp<20)p.hp=p.maxHp;
   r.draw(g,p.id,dt);if(now-hud>80){setSample({...p,contactIn:Math.max(0,2.5-cycle)});hud=now;}frame=requestAnimationFrame(tick);
  };frame=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('mouseup',release);window.removeEventListener('blur',blur);element.removeEventListener('mousedown',press);element.removeEventListener('mousemove',aim);r.dispose();};
 // The world mounts once. Lesson changes use the controller above.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return <div className="practice-screen"><canvas ref={canvas} tabIndex={0} onContextMenu={e=>e.preventDefault()} aria-label="Safe combat practice arena"/>{sample&&<><PlayerHud player={sample}/><PerfectParryHud player={sample}/></>}<section className="practice-card"><span className="eyebrow">SAFE PRACTICE · {lesson+1} / {LESSONS.length}</span><h2>{LESSONS[lesson][0]}</h2><p>{LESSONS[lesson][1]}</p>{lesson>=3&&<div className="practice-cue" role="meter" aria-label="Seconds until training contact" aria-valuemin={0} aria-valuemax={2.5} aria-valuenow={sample?.contactIn??2.5}>Contact in {(sample?.contactIn??2.5).toFixed(1)}s</div>}<small role="status">{success?'✓ Practiced successfully.':message||'No death penalty. Try as often as you like.'}</small><div><button className="primary" disabled={!success} onClick={advance}>{lesson===LESSONS.length-1?'Finish practice':'Next lesson ↗'}</button><button className="text-button" onClick={onFinish}>Skip practice</button></div></section></div>;
}
