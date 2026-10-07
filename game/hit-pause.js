import { BALANCE } from './config.js';
import { step } from './engine.js';

// Owned by the solo client. Co-op continues to use the unpaused shared engine.
export class SoloHitPause {
  constructor(){this.reset();}
  reset(){this.remaining=0;}
  advance(g,inputs,dt,playerId){
    let left=dt,simulated=0;
    while(left>1e-8){
      if(this.remaining>0){
        const frozen=Math.min(left,this.remaining);
        this.remaining=Math.max(0,this.remaining-frozen);
        left-=frozen;
        continue;
      }
      const tick=Math.min(left,1/60),previousEvent=g.eventSerial;
      step(g,inputs,tick);
      simulated+=tick;left-=tick;
      // Only events created by this tick count; multi-target impacts use the
      // longest pause, and a perfect parry takes priority over a melee hit.
      for(const e of g.events)if(e.id>previousEvent&&e.who===playerId){
        if(e.kind==='perfect')this.remaining=Math.max(this.remaining,BALANCE.soloPerfectHitPause);
        else if(e.kind==='hit'&&e.weaponAction==='melee')this.remaining=Math.max(this.remaining,BALANCE.soloMeleeHitPause);
      }
    }
    return simulated;
  }
}
