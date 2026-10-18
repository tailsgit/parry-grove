import {FEEL} from './feel-config.js';
// Copy and presentation state only. Never consulted by the combat simulation.
export function inventoryState(phase,online,returnToMenu=false){
 if(phase==='death')return {status:'Run ended',description:'Review the upgrades you collected this run.',back:'Back to results'};
 if(phase==='victory')return {status:'Run complete',description:'Your completed build. Both areas cleared.',back:'Back to results'};
 if(phase==='levelclear')return {status:'Area cleared',description:'Review your build before entering the next area.',back:'Back to area results'};
 return {status:online?'Co-op run':'Solo run paused',description:online?(phase==='combat'?'Combat continues for your party while you browse.':'Your party can continue progressing while you browse.'):'Your solo run is paused while you browse.',back:returnToMenu?'Back to run menu':'Back to game'};
}
export function lobbyEquipment(member,host,game){const p=game?.players?.find(p=>p.id===member.id);return [member.id===host?'Host':'Party member',p?.kitId?'Kit selected':'Kit not selected'].join(' · ');}
export function criticalHealth(player){return player.hp>0&&player.maxHp>0&&player.hp/player.maxHp<=FEEL.criticalRatio;}
export const UI_TIMING=Object.freeze({confirm:280,clear:180,overlay:160});
