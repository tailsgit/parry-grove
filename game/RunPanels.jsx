'use client';
import {KITS,shopPurchaseProblem} from './run-content.js';
import {WEAPONS,UPGRADES,RARITY_COLORS,BALANCE} from './config.js';

export default function RunPanels({game:g,player:p,host,action}){
  const currentRoom=(g.stage??0)*BALANCE.encounters+g.room;
  if(g.phase==='draft'){
    const near=g.kits.find(k=>!k.claimedBy&&p&&Math.hypot(p.x-k.x,p.y-k.y)<=80),kit=near&&KITS.find(k=>k.id===near.id);
    if(p?.kitId)return <div className="draft-wait" role="status">Kit claimed · waiting for your party</div>;
    if(!kit)return null;
    return <section className="draft-tooltip" aria-label="Nearby weapon kit" style={{left:`calc(var(--arena-left, 0px) + var(--arena-width, 100%) * ${near.x/g.width})`,top:`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${near.y/g.height} - 60px)`}}><strong>{kit.name}</strong><span>{WEAPONS[kit.weapon].name}</span><p>{kit.desc}</p><button onClick={()=>action('kit',{kit:kit.id})}>Pick up · E</button></section>;
  }
  if(g.phase==='route')return <p className="route-accessibility" role="status">{host?'Walk through an open door to choose the next room.':'The host chooses the next room by walking through a door.'} {g.routeOptions.includes('continue')&&'Sword at the left: combat.'} {g.routeOptions.includes('altar')&&'Blood altar at the right: choose an upgrade and accept a random curse.'} {g.routeOptions.includes('shop')&&'Coin at the bottom: shop.'}</p>;
  if(g.phase==='shop'){
    let near=null,best=70;for(const item of g.stock||[]){const gap=p?Math.hypot(p.x-item.x,p.y-item.y):Infinity;if(item.left>0&&g.time>=item.readyAt&&gap<best){near=item;best=gap;}}
    if(!near)return <p className="route-accessibility" role="status">Move near an item and press E to buy it with shared Scrap. Red prices cost more than the party can afford. {host?'Walk through the right exit to continue.':'The host leads the party through the exit.'}</p>;
    const problem=shopPurchaseProblem(g,p,near,false);
    return <section className="draft-tooltip shop-tooltip" aria-label="Nearby shop item" style={{left:`calc(var(--arena-left, 0px) + var(--arena-width, 100%) * ${near.x/g.width})`,top:`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${Math.min(near.y,p.y)/g.height} - 60px)`,'--shop-tooltip-bottom':`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${Math.max(near.y,p.y)/g.height} + 60px)`}}><strong>{near.name}</strong>{near.rarity&&<strong className="rarity-tag" style={{color:RARITY_COLORS[near.rarity]}}>{near.rarity}</strong>}<p>{near.desc}</p><span className={g.scrap<near.cost?'price-unaffordable':'price-affordable'}>{near.cost} Scrap · {near.left} left</span><small>{problem||'Move close and press E to buy'}</small></section>;
  }
  if(g.phase!=='altar')return null;
  if(!p?.altarOpen)return <div className="run-hint"><b>Sacrifice room · {g.scrap} shared Scrap</b><p>Walk to the altar and press E to interact. {host?'Use E at the right-hand exit to continue.':'The host chooses when the party leaves.'}</p></div>;
  const accepted=p.altarUsed===g.stopSerial,curse=accepted?p.curses?.at(-1):null;
  return <section className="screen-modal centered vendor-modal" role="dialog" aria-label="Sacrifice altar"><span className="eyebrow">TEMPORARY RUN SACRIFICE</span><h2>Power has a price.</h2><strong className="vendor-stats">HP {Math.ceil(p.hp)} / {p.maxHp} · SHIELD {100-(p.shieldDamage||0)} / 100</strong><p>{accepted&&curse?<><b>CURSE RECEIVED · {curse.name}</b><br/>{curse.description}<br/><small>Lasts {Math.max(1,curse.expiresAtRoom-currentRoom+1)} rooms · {curse.rarity} upgrade curse</small></>:accepted?'Sacrifice accepted. Your curse is recorded in Collected upgrades.':'Choose an upgrade. The altar assigns a random curse you cannot choose; rarer upgrades bring stronger, longer curses.'}</p><div className="reward-grid">{g.altarOffers.map(id=>{const u=UPGRADES.find(u=>u.id===id);return <button className="reward" key={id} disabled={accepted||p.upgrades.includes(id)} onClick={()=>action('sacrifice',{item:id})}><span>{u.icon}</span><div><b>{u.name}</b><small>{u.desc}</small><strong className="rarity-tag" style={{color:RARITY_COLORS[u.rarity]}}>{u.rarity}</strong></div></button>;})}</div><button className="secondary" onClick={()=>action('vendorClose')}>Back to arena · Esc</button></section>;
}
