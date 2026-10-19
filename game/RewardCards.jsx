'use client';
import {UPGRADES,RARITY_COLORS} from './config.js';
import {UpgradeIcon,RarityBadge,EffectText} from './UpgradeVisual.jsx';
export default function RewardCards({offers,disabled,selectedId,onPick}){
 return <div className="reward-grid upgrade-cards">{offers.map((id,index)=>{const u=UPGRADES.find(u=>u.id===id);if(!u)return null;return <button className={`reward upgrade-card${selectedId===id?' reward-selected':''}`} aria-pressed={selectedId===id} style={{'--reward-accent':RARITY_COLORS[u.rarity],'--reveal-delay':`${index*.045}s`}} key={id} disabled={disabled} onClick={()=>{if(!disabled)onPick(id);}}><RarityBadge rarity={u.rarity}/><span className="upgrade-icon"><UpgradeIcon id={id}/></span><div className="upgrade-copy"><b>{u.name}</b><small><EffectText text={u.desc}/></small></div><span className="upgrade-select"><kbd>{index+1}</kbd> {selectedId===id?'Selected':'Select'}</span></button>;})}</div>;
}
export function RewardConfirmation({event}){const upgrade=UPGRADES.find(u=>u.id===event.itemId);return <div className="reward-confirmation" key={event.id} role="status"><UpgradeIcon id={upgrade?.id}/><strong>{upgrade?.name||event.text}</strong><small>Added to your build</small></div>;}
