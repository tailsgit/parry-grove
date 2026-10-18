import {FEEL,clamp} from './feel-config.js';
import {compact} from './performance.js';

const live=e=>e.life>0;
const push=(list,value,limit)=>{if(list.length>=limit)list.shift();list.push(value);};

// Per-viewer state. Never writes to entities, snapshots, or simulation RNG.
export class CombatFeedback{
  constructor(){this.reset();}
  reset(){
    this.clock=0;this.lastEvent=0;this.contacts=[];this.reactions=new Map();
    this.swings=new Map();this.ghosts=[];this.ghostAt=new Map();this.reflections=new Map();
    this.flights=[];this.arrivals=0;this.impulse={x:0,y:0,life:0,strength:0};
  }
  accept(e,time){
    if(e.id<=this.lastEvent)return false;
    this.lastEvent=e.id;
    return time-e.time<=FEEL.eventAge;
  }
  impulseAt(angle,strength){
    const a=this.impulse;
    if(strength<a.strength&&a.life>0)return;
    a.x=Math.cos(angle);a.y=Math.sin(angle);a.strength=Math.min(FEEL.shake,strength);a.life=FEEL.impulseTime;
  }
  contact(e,profile,scale=1){
    const f=e.fx||{};
    push(this.contacts,{x:f.x??e.x,y:f.y??e.y,angle:f.angle||0,life:FEEL.contactTime,max:FEEL.contactTime,color:profile.color,scale},FEEL.contacts);
    this.react(f.targetId,f.angle||0,scale);
  }
  react(id,angle,scale=1){
    if(id==null)return;
    if(!this.reactions.has(id)&&this.reactions.size>=FEEL.reactions)this.reactions.delete(this.reactions.keys().next().value);
    this.reactions.set(id,{angle,life:FEEL.recoilTime,scale});
  }
  scrap(e){
    const amount=e.fx?.amount;
    if(!(amount>0))return;
    const last=this.flights.at(-1);
    if(last&&(last.age<FEEL.flightGroup||this.flights.length>=FEEL.flights)){
      const weight=amount/(last.amount+amount);
      last.x+=(e.x-last.x)*weight;last.y+=(e.y-last.y)*weight;last.amount+=amount;
    }else push(this.flights,{x:e.x,y:e.y,amount,age:0,life:FEEL.flightTime,max:FEEL.flightTime},FEEL.flights);
  }
  advance(dt,g,reduced=false){
    dt=Math.max(0,Math.min(.05,dt));this.clock+=dt;
    for(const list of [this.contacts,this.ghosts]){for(const e of list)e.life-=dt;compact(list,live);}
    for(const [id,r] of this.reactions){r.life-=dt;if(r.life<=0)this.reactions.delete(id);}
    for(const [id,r] of this.reflections){r.life-=dt;if(r.life<=0)this.reflections.delete(id);}
    this.impulse.life=Math.max(0,this.impulse.life-dt);
    if(!this.impulse.life)this.impulse.strength=0;
    for(const f of this.flights){f.age+=dt;f.life-=dt;if(f.life<=0)this.arrivals++;}
    compact(this.flights,live);
    for(const p of g.players){
      if(p.swing<=0)this.swings.delete(p.id);
      if(!reduced&&p.hp>0&&p.dashLeft>0&&this.clock-(this.ghostAt.get(p.id)??-1)>=FEEL.ghostGap){
        this.ghostAt.set(p.id,this.clock);
        push(this.ghosts,{who:p.id,x:p.x,y:p.y,slot:p.slot,dx:p.dx,dy:p.dy,life:FEEL.ghostLife,max:FEEL.ghostLife},FEEL.afterimages);
      }
    }
    const ids=new Set(g.players.map(p=>p.id));for(const id of this.ghostAt.keys())if(!ids.has(id))this.ghostAt.delete(id);
  }
  cameraOffset(reduced=false){
    if(reduced)return {x:0,y:0};
    const a=this.impulse,t=clamp(a.life/FEEL.impulseTime,0,1),s=reduced?0:a.strength*t*t;
    return {x:-a.x*s,y:-a.y*s};
  }
}
