import {FEEL,clamp} from './feel-config.js';

// Synthesized locally; no borrowed assets. Distinct attack, contact and movement cues.
const VOICES={
  swing:[230,.11,'air'],hit:[170,.1,'impact'],perfect:[1040,.22,'bell'],regular:[310,.12,'wood'],
  dash:[520,.16,'air'],dashend:[160,.09,'air'],pickup:[980,.12,'chime'],ui:[620,.045,'chime'],
  explosion:[68,.38,'boom'],bossdeath:[48,.5,'boom'],hurt:[105,.16,'impact'],
  block:[220,.08,'wood'],shieldbreak:[130,.25,'impact'],enemyparry:[600,.13,'bell'],
  kill:[480,.09,'wood'],guard:[500,.035,'chime'],miss:[180,.045,'wood'],
  upgrade:[740,.22,'chime'],kitpickup:[760,.16,'chime'],purchase:[680,.12,'chime'],
  sacrifice:[320,.3,'bell'],shopdeny:[150,.08,'wood'],doorsopen:[420,.15,'chime'],
  level:[920,.2,'chime'],clear:[650,.2,'chime'],levelclear:[980,.25,'chime'],
  mortar:[180,.12,'wood'],victory:[1000,.3,'bell'],
};

export function renderFeedbackSound(kind,sampleRate=48000){
  const profile=VOICES[kind];if(!profile)return null;
  const [frequency,duration,mode]=profile,out=new Float32Array(Math.ceil(duration*sampleRate));
  let seed=12345,phase=0,filtered=0;
  for(let i=0;i<out.length;i++){
    const t=i/sampleRate,u=t/duration;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=seed/2147483648-1;filtered+=.12*(noise-filtered);
    phase+=Math.PI*2*frequency*(mode==='air'?1.3-u*.8:Math.exp(-u*.9))/sampleRate;
    const envelope=Math.min(1,t/.002)*Math.min(1,(duration-t)/.018)*Math.exp(-u*(mode==='air'?1:5));
    let wave;
    if(mode==='air')wave=(noise-filtered)*Math.sin(Math.PI*u)*.75+filtered*.6;
    else if(mode==='impact')wave=Math.sin(phase)*.4+noise*.5*Math.exp(-t*70);
    else if(mode==='boom')wave=Math.sin(phase)*.7+Math.sin(phase*.51)*.25+noise*.7*Math.exp(-t*90)+filtered*.5;
    else if(mode==='bell')wave=Math.sin(phase)*.5+Math.sin(phase*2.73)*.23*Math.exp(-t*18)+noise*.15*Math.exp(-t*100);
    else if(mode==='wood')wave=Math.sin(phase)*.55+noise*.3*Math.exp(-t*45);
    else wave=Math.sin(phase)*.6+Math.sin(phase*2)*.2;
    out[i]=Math.tanh(wave*envelope)*.5;
  }
  return out;
}

export class FeedbackAudio{
  constructor(context,destination){
    this.context=context;this.output=context.createGain();this.output.connect(destination);
    this.voices=[];this.buffers=new Map();this.last=new Map();this.pickupAt=-10;this.pickupChain=0;this.sequence=0;
  }
  setMuted(value){this.muted=value;this.output.gain.setValueAtTime(value?0:1,this.context.currentTime);}
  play(kind,volume=1){
    const c=this.context,now=c.currentTime;
    if(this.muted||c.state!=='running'||!VOICES[kind])return false;
    const gap=kind==='pickup'?FEEL.pickupGap:FEEL.soundGap;
    if(now-(this.last.get(kind)??-10)<gap)return false;
    this.last.set(kind,now);
    if(kind==='pickup'){
      this.pickupChain=now-this.pickupAt>FEEL.pickupReset?0:Math.min(FEEL.pickupPitchCap,this.pickupChain+1);
      this.pickupAt=now;
    }
    let buffer=this.buffers.get(kind);
    if(!buffer){const data=renderFeedbackSound(kind,c.sampleRate);buffer=c.createBuffer(1,data.length,c.sampleRate);buffer.getChannelData(0).set(data);this.buffers.set(kind,buffer);}
    const source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;
    const variation=[1,.975,1.025,.99,1.015][this.sequence++%5];
    source.playbackRate.value=kind==='pickup'?2**(this.pickupChain/12):variation;
    gain.gain.value=clamp(volume,0,1)*(kind==='ui'?.09:.22);
    source.connect(gain);gain.connect(this.output);
    if(this.voices.length>=FEEL.voices)this.voices.shift().stop();
    this.voices.push(source);source.onended=()=>{source.disconnect();gain.disconnect();const i=this.voices.indexOf(source);if(i>=0)this.voices.splice(i,1);};source.start();return true;
  }
  dispose(){for(const source of [...this.voices])source.stop();this.voices.length=0;this.output.disconnect();}
}
