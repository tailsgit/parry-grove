'use client';
import {KITS,shopPurchaseProblem} from './run-content.js';
import {WEAPONS,UPGRADES} from './config.js';

export default function RunPanels({game:g,player:p,host,action}){
  if(g.phase==='draft'){
    const near=g.kits.find(k=>!k.claimedBy&&p&&Math.hypot(p.x-k.x,p.y-k.y)<=80),kit=near&&KITS.find(k=>k.id===near.id);
    if(p?.kitId)return <div className="draft-wait" role="status">Kit claimed · waiting for your party</div>;
    if(!kit)return null;
    return <section className="draft-tooltip" aria-label="Nearby weapon kit" style={{left:`calc(var(--arena-left, 0px) + var(--arena-width, 100%) * ${near.x/g.width})`,top:`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${near.y/g.height} - 60px)`}}><strong>{kit.name}</strong><span>{WEAPONS[kit.weapon].name}</span><p>{kit.desc}</p><button onClick={()=>action('kit',{kit:kit.id})}>Pick up · E</button></section>;
  }
  if(g.phase==='route')return <p className="route-accessibility" role="status">{host?'Walk through an open door to choose the next room.':'The host chooses the next room by walking through a door.'} {g.routeOptions.includes('continue')&&'Sword at the left: combat.'} {g.routeOptions.includes('altar')&&'Blood altar at the right: sacrifice.'} {g.routeOptions.includes('shop')&&'Coin at the bottom: shop.'}</p>;
  if(g.phase==='shop'){
    let near=null,best=70;for(const item of g.stock||[]){const gap=p?Math.hypot(p.x-item.x,p.y-item.y):Infinity;if(item.left>0&&g.time>=item.readyAt&&gap<best){near=item;best=gap;}}
    if(!near)return <p className="route-accessibility" role="status">Walk into an item to buy it with shared Scrap. Red prices cost more than the party can afford. {host?'Walk through the right exit to continue.':'The host leads the party through the exit.'}</p>;
    const problem=shopPurchaseProblem(g,p,near,false)||((p.shopContacts||0)&(1<<g.stock.indexOf(near))?'Step off and return to buy another':'');
    return <section className="draft-tooltip shop-tooltip" aria-label="Nearby shop item" style={{left:`calc(var(--arena-left, 0px) + var(--arena-width, 100%) * ${near.x/g.width})`,top:`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${Math.min(near.y,p.y)/g.height} - 60px)`,'--shop-tooltip-bottom':`calc(var(--arena-top, 0px) + var(--arena-height, 100%) * ${Math.max(near.y,p.y)/g.height} + 60px)`}}><strong>{near.name}</strong><p>{near.desc}</p><span className={g.scrap<near.cost?'price-unaffordable':'price-affordable'}>{near.cost} Scrap · {near.left} left</span><small>{problem||'Walk into the item to buy'}</small></section>;
  }
  if(g.phase!=='altar')return null;
  if(!p?.altarOpen)return <div className="run-hint"><b>Sacrifice room · {g.scrap} shared Scrap</b><p>Walk to the altar and press E to interact. {host?'Use E at the right-hand exit to continue.':'The host chooses when the party leaves.'}</p></div>;
  return <section className="screen-modal centered vendor-modal" role="dialog" aria-label="Sacrifice altar"><span className="eyebrow">PERMANENT RUN SACRIFICE</span><h2>Power has a price.</h2><strong className="vendor-stats">HP {Math.ceil(p.hp)} / {p.maxHp} · SHIELD {100-(p.shieldDamage||0)} / 100</strong><p>{p.altarUsed===g.stopSerial?'Sacrifice accepted. Your health penalty lasts for the remainder of this run.':`Lose ${Math.ceil(p.maxHp*.25)} maximum HP (25%) for one relic. The penalty also applies to future health gains.`}</p><div className="reward-grid">{g.altarOffers.map(id=>{const u=UPGRADES.find(u=>u.id===id);return <button className="reward" key={id} disabled={p.altarUsed===g.stopSerial||p.upgrades.includes(id)||p.maxHp<20} onClick={()=>action('sacrifice',{item:id})}><span>{u.icon}</span><div><b>{u.name}</b><small>{u.desc}</small></div></button>;})}</div><button className="secondary" onClick={()=>action('vendorClose')}>Back to arena · Esc</button></section>;
}
