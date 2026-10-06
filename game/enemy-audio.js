// Deterministic, cached weapon samples. These never consume simulation randomness.
export const WEAPON_VOICES=Object.freeze({
 bow:{name:'Bowstring twang',mode:'pluck',f0:540,f1:190,duration:.22,noise:.18},
 pistol:{name:'Dry pistol crack',mode:'shot',f0:210,f1:65,duration:.13,noise:.8},
 homing:{name:'Seeker launch whirr',mode:'electric',f0:280,f1:690,duration:.32,noise:.12},
 shotgun:{name:'Shotgun boom and pump',mode:'spread',f0:115,f1:38,duration:.3,noise:.86},
 mortar:{name:'Mortar tube thump',mode:'launch',f0:135,f1:42,duration:.28,noise:.44},
 brawler:{name:'Heavy gauntlet swing',mode:'whoosh',f0:95,f1:45,duration:.17,noise:.7},
 lancer:{name:'Spear thrust and ring',mode:'metal',f0:650,f1:240,duration:.2,noise:.35},
 railgun:{name:'Rail beam snap and hum',mode:'beam',f0:920,f1:180,duration:1,noise:.14},
 miner:{name:'Mine latch and arming click',mode:'latch',f0:980,f1:710,duration:.21,noise:.23},
 ricochet:{name:'Metallic ricochet gun crack',mode:'metalshot',f0:420,f1:160,duration:.2,noise:.7},
 suicide:{name:'Bomber fuse ticks',mode:'fuse',f0:1650,f1:2450,duration:.35,noise:.22},
 cluster:{name:'Grenade launcher thunk and rattle',mode:'rattle',f0:170,f1:62,duration:.25,noise:.55},
 magnet:{name:'Conductor dart zap',mode:'electric',f0:1200,f1:2600,duration:.18,noise:.07},
 sine:{name:'Undulating sine gun pulse',mode:'wave',f0:420,f1:780,duration:.29,noise:.03},
 riot:{name:'Shield scrape and bash',mode:'metal',f0:170,f1:75,duration:.28,noise:.76},
 boomerang:{name:'Boomerang air whip',mode:'whoosh',f0:720,f1:210,duration:.38,noise:.45},
 twinBomber:{name:'Heavy boss grenade launcher',mode:'rattle',f0:88,f1:30,duration:.36,noise:.73},
 twinRicochet:{name:'Boss ricochet double crack',mode:'metalshot',f0:310,f1:90,duration:.29,noise:.83},
 boss:{name:'Brass Warden cannon report',mode:'brass',f0:185,f1:54,duration:.34,noise:.58},
});
const EXTRA={miner:['arm','impact'],suicide:['arm','impact'],cluster:['land','split'],twinBomber:['place','arm','impact','land','split'],mortar:['impact'],boss:['charge','launch','impact'],ricochet:['bounce'],twinRicochet:['bounce']};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function actionKey(kind,action){if((EXTRA[kind]||[]).includes(action))return action;return 'attack';}
function settings(kind,action){
 const base=WEAPON_VOICES[kind];if(!Object.hasOwn(WEAPON_VOICES,kind))return null;
 const key=actionKey(kind,action),p={...base};
 if(key==='impact'){p.mode='spread';p.f0=55+base.f0%35;p.f1=24;p.duration=.43;p.noise=.85;}
 if(key==='arm'){p.mode='fuse';p.f0=1400+base.f0%600;p.f1=2600;p.duration=.32;p.noise=.08;}
 if(key==='place'){p.mode='latch';p.f0=750;p.f1=430;p.duration=.2;p.noise=.3;}
 if(key==='bounce'){p.mode='metal';p.f0=base.f0*3;p.f1=base.f0;p.duration=.1;p.noise=.1;}
 if(key==='land'){p.mode='latch';p.f0=base.f0*2;p.f1=90;p.duration=.13;p.noise=.5;}
 if(key==='split'){p.mode='rattle';p.f0=base.f0*3;p.f1=120;p.duration=.23;p.noise=.85;}
 if(key==='charge'){p.mode='brass';p.f0=65;p.f1=240;p.duration=.8;p.noise=.25;}
 if(key==='launch'){p.mode='launch';p.f0=105;p.f1=32;p.duration=.32;p.noise=.6;}
 return p;
}
export function weaponDuration(kind,action='attack'){return settings(kind,action)?.duration||0;}
export function renderWeaponSound(kind,action='attack',sampleRate=48000,output){
 const p=settings(kind,action);if(!p)return null;
 const data=output||new Float32Array(Math.ceil(sampleRate*p.duration));let seed=2166136261,phase=0,filtered=0;
 for(const ch of kind+actionKey(kind,action))seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
 for(let i=0;i<data.length;i++){
  const t=i/sampleRate,u=t/p.duration;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;filtered+=.15*(noise-filtered);
  const f=p.f0*Math.pow(p.f1/p.f0,Math.min(1,u));phase+=2*Math.PI*f/sampleRate;
  const attack=Math.min(1,t/.003),fade=Math.min(1,(p.duration-t)/.025);let env=attack*fade*Math.exp(-u*4),tone=Math.sin(phase),air=noise-filtered;
  if(p.mode==='pluck'){tone+=.45*Math.sin(phase*2)+.16*Math.sin(phase*4.01);air*=Math.exp(-t*85);}
  if(p.mode==='shot'||p.mode==='metalshot'){tone+=.25*Math.sin(phase*2.7);env*=1+.7*Math.exp(-t*160);if(p.mode==='metalshot')tone+=.35*Math.sin(phase*4.13);if(kind==='twinRicochet')env+=.35*Math.exp(-Math.abs(t-.045)*90)*fade;}
  if(p.mode==='spread'){air=filtered*2+air*.5;tone+=.45*Math.sin(phase*.5);env*=1+.5*Math.exp(-t*60);}
  if(p.mode==='launch'){air=filtered*2;tone+=.35*Math.sin(phase*.51);}
  if(p.mode==='metal'){tone+=.6*Math.sin(phase*2.73)+.35*Math.sin(phase*4.19);}
  if(p.mode==='whoosh'){env=attack*fade*Math.sin(Math.PI*Math.min(1,u))**.7;air=filtered*2+air*.15;tone*=.3;}
  if(p.mode==='electric'){tone=Math.sin(phase+Math.sin(t*95)*2.5)+.3*Math.sin(phase*.5);env=attack*fade*Math.exp(-u*2);}
  if(p.mode==='wave'){tone=Math.sin(phase+Math.sin(t*34)*4);env=attack*fade*Math.exp(-u*2);}
  if(p.mode==='beam'){tone=.45*Math.sin(phase)+.2*Math.sin(phase*3)+.12*Math.sin(phase*7);env=attack*fade*(.35+.65*Math.exp(-t*35));}
  if(p.mode==='latch'){env=fade*(Math.exp(-t*70)+.6*Math.exp(-Math.abs(t-.085)*95));tone+=.5*Math.sin(phase*2.4);}
  if(p.mode==='fuse'){const pulse=(t*22)%1;env=fade*Math.exp(-pulse*12);tone=Math.sin(phase);}
  if(p.mode==='rattle'){env*=.6+.4*Math.cos(t*140)**2;air=filtered+air*.8;tone+=.25*Math.sin(phase*3.1);}
  if(p.mode==='brass'){tone+=.45*Math.sin(phase*2)+.24*Math.sin(phase*3)+.12*Math.sin(phase*4);if(action==='charge')env=attack*fade*(.2+.8*u);}
  data[i]=Math.tanh((tone*(1-p.noise)+air*p.noise)*env)*.42;
 }
 return data;
}
export class EnemyAudio{
 constructor(context){
  this.context=context;this.buffers=new Map();this.voices=[];this.input=context.createGain();this.limiter=context.createDynamicsCompressor();this.output=context.createGain();
  this.limiter.threshold.value=-8;this.limiter.knee.value=12;this.limiter.ratio.value=6;this.limiter.attack.value=.003;this.limiter.release.value=.12;
  this.input.connect(this.limiter);this.limiter.connect(this.output);this.output.connect(context.destination);
  // Prepare the small sound bank once at audio unlock, before combat starts.
  for(const kind of Object.keys(WEAPON_VOICES)){this.buffer(kind,'attack');for(const action of EXTRA[kind]||[])this.buffer(kind,action);}
 }
 buffer(kind,action){const key=kind+':'+actionKey(kind,action);let buffer=this.buffers.get(key);if(!buffer){buffer=this.context.createBuffer(1,Math.ceil(this.context.sampleRate*weaponDuration(kind,action)),this.context.sampleRate);renderWeaponSound(kind,action,this.context.sampleRate,buffer.getChannelData(0));this.buffers.set(key,buffer);}return buffer;}
 setMuted(value){this.muted=value;this.output.gain.setValueAtTime(value?0:1,this.context.currentTime);}
 play(event,listener,width){
  if(this.muted||!Object.hasOwn(WEAPON_VOICES,event.sourceKind))return false;
  const c=this.context;if(c.state!=='running')return false;
  const dx=listener?event.x-listener.x:0,dy=listener?event.y-listener.y:0,distance=Math.hypot(dx,dy);
  const source=c.createBufferSource(),gain=c.createGain(),pan=c.createStereoPanner();source.buffer=this.buffer(event.sourceKind,event.weaponAction);
  gain.gain.value=.17/(1+distance/420);pan.pan.value=clamp(dx/Math.max(1,width*.5),-.85,.85);source.connect(gain);gain.connect(pan);pan.connect(this.input);
  if(this.voices.length>=16)this.voices.shift().stop();
  this.voices.push(source);source.onended=()=>{source.disconnect();gain.disconnect();pan.disconnect();const index=this.voices.indexOf(source);if(index>=0)this.voices.splice(index,1);};source.start();return true;
 }
}
