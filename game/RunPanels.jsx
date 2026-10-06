'use client';
import {KITS} from './run-content.js';
import {WEAPONS,UPGRADES} from './config.js';

export default function RunPanels({game:g,player:p,host,action}){
  if(g.phase==='draft'){
    const near=g.kits.find(k=>!k.claimedBy&&p&&Math.hypot(p.x-k.x,p.y-k.y)<=80),kit=near&&KITS.find(k=>k.id===near.id);
    if(p?.kitId)return <div className="draft-wait" role="status">Kit claimed · waiting for your party</div>;
    if(!kit)return null;
    return <section className="draft-tooltip" aria-label="Nearby weapon kit" style={{left:`calc(var(--arena-left, 0px) + var(--arena-width, 100%) * ${near.x/g.width})`,top:`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${near.y/g.height} - 60px)`}}><strong>{kit.name}</strong><span>{WEAPONS[kit.weapon].name}</span><p>{kit.desc}</p><button onClick={()=>action('kit',{kit:kit.id})}>Pick up · E</button></section>;
  }
  if(g.phase==='route')return <p className="route-accessibility" role="status">{host?'Walk through an open door to choose the next room.':'The host chooses the next room by walking through a door.'} {g.routeOptions.includes('continue')&&'Sword at the left: combat.'} {g.routeOptions.includes('altar')&&'Blood altar at the right: sacrifice.'} {g.routeOptions.includes('shop')&&'Coin at the bottom: shop.'}</p>;
  if(!['shop','altar'].includes(g.phase))return null;
  const open=g.phase==='shop'?p?.vendorOpen:p?.altarOpen;
  if(!open)return <div className="run-hint"><b>{g.phase==='shop'?'Vending room':'Sacrifice room'} · {g.scrap} shared Scrap</b><p>Walk to the {g.phase==='shop'?'vending machine':'altar'} and press E to interact. {host?'Use E at the right-hand exit to continue.':'The host chooses when the party leaves.'}</p></div>;
  return <section className="screen-modal centered vendor-modal" role="dialog" aria-label={g.phase==='shop'?'Vending machine':'Sacrifice altar'}><span className="eyebrow">{g.phase==='shop'?`${g.scrap} SHARED SCRAP · LIMITED STOCK`:'PERMANENT RUN SACRIFICE'}</span><h2>{g.phase==='shop'?'Spend it or save it.':'Power has a price.'}</h2><strong className="vendor-stats">HP {Math.ceil(p.hp)} / {p.maxHp} · SHIELD {100-(p.shieldDamage||0)} / 100</strong><p>{g.phase==='shop'?'Purchases affect you. Everyone uses the same Scrap and stock.':p.altarUsed===g.stopSerial?'Sacrifice accepted. Your health penalty lasts for the remainder of this run.':`Lose ${Math.ceil(p.maxHp*.25)} maximum HP (25%) for one relic. The penalty also applies to future health gains.`}</p><div className="reward-grid">{g.phase==='shop'?g.stock.map(item=><button className="reward" key={item.id} disabled={!item.left||g.scrap<item.cost||(UPGRADES.find(u=>u.id===item.id)?.kind&&p.upgrades.includes(item.id))} onClick={()=>action('buy',{item:item.id})}><div><b>{item.name}</b><small>{item.desc}</small><strong>{item.cost} Scrap · {item.left} left</strong></div></button>):g.altarOffers.map(id=>{const u=UPGRADES.find(u=>u.id===id);return <button className="reward" key={id} disabled={p.altarUsed===g.stopSerial||p.upgrades.includes(id)||p.maxHp<20} onClick={()=>action('sacrifice',{item:id})}><span>{u.icon}</span><div><b>{u.name}</b><small>{u.desc}</small></div></button>;})}</div><button className="secondary" onClick={()=>action('vendorClose')}>Back to arena · Esc</button></section>;
}
