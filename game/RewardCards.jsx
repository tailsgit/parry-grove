
'use client';
import {UPGRADES,RARITY_COLORS} from './config.js';
const COLORS={vitality:'#88ed9c',recovery:'#88ed9c',vampire:'#ee91a3',bloodroot:'#ee91a3',dashSpark:'#ffe07c',thunderStep:'#ffe07c',stormHeart:'#ffe07c',speed:'#8fe1e6',dash:'#8fe1e6',distance:'#8fe1e6',armor:'#bfd6a0',parry:'#9bbefa',perfection:'#9bbefa',cleanse:'#c8b4ff',stun:'#c8b4ff',stunNova:'#c8b4ff',mirrorEngine:'#9bbefa',rebound:'#9bbefa',returnForce:'#9bbefa',edge:'#f5b089',punish:'#f5b089',area:'#f5b089',echoBlade:'#f5b089',overdrive:'#f5b089'};
export default function RewardCards({offers,disabled,onPick}){
 return <div className="reward-grid upgrade-cards">{offers.map((id,index)=>{const u=UPGRADES.find(u=>u.id===id);return <button className="reward upgrade-card" style={{'--reward-accent':COLORS[id]||'#efd18b'}} key={id} disabled={disabled} onClick={()=>onPick(id)}><span className="upgrade-icon" aria-hidden="true">{u.icon}</span><div className="upgrade-copy"><b>{u.name}</b><small>{u.desc}</small></div><span className="rarity-tag" style={{color:RARITY_COLORS[u.rarity]}}>{u.rarity}</span><span className="upgrade-select">Press {index+1} <span aria-hidden="true">·</span> or click</span></button>;})}</div>;
}
