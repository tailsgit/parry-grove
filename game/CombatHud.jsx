import { BALANCE } from './config.js';

const percent=(value,max)=>Math.max(0,Math.min(100,value/max*100));

export function PlayerHud({player:p,network}){
  const hp=Math.max(0,Math.min(p.maxHp,p.hp)),internal=Math.min(hp,Math.max(0,p.internal));
  const shield=Math.max(0,BALANCE.shieldCapacity-(p.shieldDamage||0));
  return <div className="game-hud compact-hud" aria-label="Player status">
    <div className="hud-shield-bar" role="meter" aria-label="Shield" aria-valuemin={0} aria-valuemax={BALANCE.shieldCapacity} aria-valuenow={shield}>
      <i style={{width:`${percent(shield,BALANCE.shieldCapacity)}%`}}/>
    </div>
    <div className="hud-health-bar" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={p.maxHp} aria-valuenow={hp} aria-valuetext={`${Math.ceil(hp)} of ${p.maxHp} health; ${Math.ceil(p.internal)} internal damage`}>
      <i className="hud-health-fill" style={{width:`${percent(hp,p.maxHp)}%`}}/>
      {internal>0&&<i className="hud-internal-fill" style={{left:`${percent(hp-internal,p.maxHp)}%`,width:`${percent(internal,p.maxHp)}%`}}/>}
      <span aria-hidden="true">{Math.ceil(hp)} / {p.maxHp}</span>
    </div>
    <div className="hud-level">LV {p.level}</div>
    {p.magnetLeft>0&&<div className="hud-warning" role="status">MAGNETIZED · {p.magnetLeft.toFixed(1)}s</div>}
    {p.shieldBroken&&<div className="hud-warning" role="status">SHIELD BROKEN</div>}
    {p.stun>0&&<div className="hud-warning" role="status">STUNNED · {p.stun.toFixed(1)}s</div>}
    {network&&<small className="hud-network">{network}</small>}
  </div>;
}

export function PerfectParryHud({player:p}){
  if(p.hp<=0||p.streak<=0||p.streakLeft<=0)return null;
  // Dagger grants two damage-bonus stacks per parry; show actual parries.
  const count=Math.ceil(p.streak/(p.weapon==='dagger'?2:1));
  const intensity=Math.min(5,count-1);
  return <div className="parry-combo" style={{'--combo-size':`${76+intensity*5}px`,'--combo-burst':1.65+intensity*.1}} aria-label={`${count} consecutive perfect ${count===1?'parry':'parries'}`}>
    <div className="parry-impact" key={p.perfects}>
      <span className="parry-burst" aria-hidden="true"/>
      <strong className="parry-count">{count}</strong>
    </div>
    <span className="parry-combo-label" aria-hidden="true">PERFECT</span>
    <div className="parry-combo-timer" role="meter" aria-label="Perfect parry combo time remaining" aria-valuemin={0} aria-valuemax={BALANCE.streakTimeout} aria-valuenow={Math.max(0,p.streakLeft)}>
      <i style={{width:`${percent(p.streakLeft,BALANCE.streakTimeout)}%`}}/>
    </div>
  </div>;
}
