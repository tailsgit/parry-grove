import {clamp} from './feel-config.js';

// Presentation only. The existing .2-second swing timer starts at damage resolution.
// Spend its first 50 ms on the strike, then follow through and recover within it.
export const ENEMY_MELEE_VISUALS=Object.freeze({swingTime:.2,strikeTime:.05,followTime:.035,trailTime:.085,trailWidth:3,cacheLimit:128});
const smooth=t=>t*t*(3-2*t);

export function enemyMeleePose(e,cfg){
  const thrust=e.kind==='lancer',bash=e.kind==='riot',idleTip=thrust?60:bash?33:41;
  const pose={angle:0,tip:idleTip,trail:false,tail:0,alpha:0,phase:'idle',thrust,bash};
  if(!cfg.melee||e.action==='parry')return pose;
  if(e.tell>0){
    const charge=clamp(1-e.tell/(e.tellTotal||cfg.tell),0,1),pull=smooth(Math.min(1,charge/.8));
    pose.phase='windup';
    // Spear and shield draw back along the attack axis; the axe coils behind it.
    pose.angle=-(cfg.arc/2+(thrust?.12:bash?.16:.35))*pull;
    pose.tip=idleTip-(thrust?25:bash?10:0)*pull;
    if(!thrust&&!bash)pose.tip=idleTip+(cfg.range-idleTip)*pull;
    return pose;
  }
  if(!(e.swing>0))return pose;
  const elapsed=clamp(ENEMY_MELEE_VISUALS.swingTime-e.swing,0,ENEMY_MELEE_VISUALS.swingTime);
  const strike=clamp(elapsed/ENEMY_MELEE_VISUALS.strikeTime,0,1);
  const recover=clamp((elapsed-ENEMY_MELEE_VISUALS.strikeTime-ENEMY_MELEE_VISUALS.followTime)/(ENEMY_MELEE_VISUALS.swingTime-ENEMY_MELEE_VISUALS.strikeTime-ENEMY_MELEE_VISUALS.followTime),0,1);
  // Contact is immediate in the simulation: start visibly extended at contact,
  // then cross the remaining arc. Never imply a delayed or second damage window.
  pose.phase=recover>0?'recovery':strike<1?'strike':'follow';
  const edgeMargin=Math.asin((bash?22:thrust?0:10)/cfg.range);
  pose.angle=(cfg.arc/2-edgeMargin)*smooth(strike)*(1-smooth(recover));
  pose.tip=cfg.range+(idleTip-cfg.range)*smooth(recover);
  pose.trail=elapsed<ENEMY_MELEE_VISUALS.trailTime;
  pose.tail=-cfg.arc/2+cfg.arc*.55*clamp((elapsed-ENEMY_MELEE_VISUALS.strikeTime)/ENEMY_MELEE_VISUALS.followTime,0,1);
  pose.alpha=.7*(1-elapsed/ENEMY_MELEE_VISUALS.trailTime);
  return pose;
}

export function drawEnemyMeleeTrail(c,pose,cfg,reducedMotion){
  if(!pose.trail)return;
  c.save();c.globalAlpha=pose.alpha*(reducedMotion?.45:1);c.strokeStyle='#ffe4bb';c.lineWidth=ENEMY_MELEE_VISUALS.trailWidth;
  // A short swept tip contour, never a filled sector. Radius includes stroke width.
  c.beginPath();c.arc(0,0,cfg.range-ENEMY_MELEE_VISUALS.trailWidth/2,pose.tail,pose.angle);c.stroke();
  if(pose.thrust||pose.bash){
    // Two short axial streaks make the forward extension distinct from an axe cut.
    c.rotate(pose.angle);c.lineWidth=1.5;
    const width=pose.bash?15:5;
    for(const y of [-width,width]){c.beginPath();c.moveTo(cfg.range*.6,y);c.lineTo(cfg.range-4,y);c.stroke();}
  }
  c.restore();
}
