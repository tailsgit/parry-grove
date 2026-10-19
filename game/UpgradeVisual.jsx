import {RARITY_COLORS} from './config.js';
import {upgradeGlyph,upgradeMark} from './upgrade-art.js';
export function UpgradeIcon({id,className=''}){return <svg className={`upgrade-art ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" shapeRendering="crispEdges" aria-hidden="true"><path d={upgradeGlyph(id)}/>{upgradeMark(id)&&<path className="icon-sigil" d={upgradeMark(id)} strokeWidth="2"/>}</svg>;}
export function RarityBadge({rarity='common'}){return <span className="rarity-badge" data-rarity={rarity} style={{'--rarity-tone':RARITY_COLORS[rarity]||RARITY_COLORS.common}}>{rarity}</span>;}
export function EffectText({text=''}){return text.split(/([+−-]?\d+(?:\.\d+)?(?:%|ms|s| HP)?)/g).map((part,i)=>i%2?<strong className="effect-value" key={i}>{part}</strong>:part);}
