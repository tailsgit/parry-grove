'use client';
import {useEffect,useRef,useState} from 'react';
import {ENEMIES} from './config.js';
import {Renderer} from './renderer.js';
import {filterEnemies} from './enemy-guide.js';
const portraits=new Map();
// Render the actual in-game sprite once, then reuse a static image. No animation
// loop, audio context or particle pools are created for encyclopedia portraits.
function portrait(kind){
  if(portraits.has(kind))return portraits.get(kind);
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=272;
  const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.translate(112,140);c.scale(2.4,2.4);
  const cfg=ENEMIES[kind],enemy={kind,x:0,y:0,angle:0,hp:cfg.hp,maxHp:cfg.hp,stun:0,tell:0,swing:0,guardLeft:0,recoil:0,minesLaid:0,mineTimer:cfg.rate,mineState:'approach'};
  Renderer.prototype.enemy.call({weapon:Renderer.prototype.weapon},c,enemy);
  const src=canvas.toDataURL('image/png');portraits.set(kind,src);return src;
}
// Cached local PNGs need no image optimizer or network request.
/* eslint-disable @next/next/no-img-element */
function EnemyPortrait({enemy}){const ref=useRef(null);useEffect(()=>{ref.current.src=portrait(enemy.id);},[enemy.id]);return <img ref={ref} className="enemy-portrait" width={384} height={272} alt={`${enemy.name} with its in-game equipment`}/>;}
export default function Settings({onClose,muted,onToggleSound,online}){
  const [page,setPage]=useState('settings'),[query,setQuery]=useState(''),[level,setLevel]=useState(0),dialog=useRef(null);
  useEffect(()=>{dialog.current?.focus();},[page]);
  function trapFocus(event){if(event.key!=='Tab')return;const elements=[...dialog.current.querySelectorAll('button:not([disabled]),input:not([disabled]),[href]')];if(!elements.length)return;event.preventDefault();const current=elements.indexOf(document.activeElement),next=(current+(event.shiftKey?-1:1)+elements.length)%elements.length;elements[next].focus();}
  const enemies=filterEnemies(query,level);
  return <section className="screen-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialog} onKeyDown={trapFocus}>
    <header className="settings-header"><div><span className="eyebrow">{page==='enemies'?'SETTINGS / FIELD GUIDE':'PARRY GROVE'}</span><h2 id="settings-title">{page==='enemies'?'Enemy encyclopedia':'Settings'}</h2></div><button className="secondary settings-close" onClick={onClose}>Close · Esc</button></header>
    {page==='settings'?<div className="settings-home"><p>{online?'Your co-op run continues while Settings is open.':'You can browse safely; Settings pauses your solo run.'}</p><button className="settings-option" onClick={onToggleSound} aria-pressed={!muted}><span>Sound</span><b>{muted?'Off':'On'}</b></button><button className="settings-option encyclopedia-link" onClick={()=>setPage('enemies')}><span><strong>Enemy encyclopedia</strong><small>Meet every enemy and boss. Learn their attacks and how to respond.</small></span><b>Open ↗</b></button></div>:<>
      <div className="guide-toolbar"><button className="text-button" onClick={()=>setPage('settings')}>← Back to Settings</button><label className="guide-search">Search enemies<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or mechanic…" type="search"/></label><div className="guide-filters" aria-label="Filter enemies by level">{[[0,'All enemies'],[1,'Level 1'],[2,'Level 2']].map(([id,label])=><button key={id} onClick={()=>setLevel(id)} aria-pressed={level===id}>{label}</button>)}</div></div>
      <p className="guide-rules">Cover stops direct shots. Nearby area attacks can trigger through cover. Red attacks can usually be blocked or dodged; <b>DASH ONLY</b> explosions require a timed dash.</p>
      <div className="guide-count" role="status">{enemies.length} {enemies.length===1?'entry':'entries'}</div>
      <div className="enemy-guide-grid">{enemies.map(enemy=><article className="enemy-guide-card" key={enemy.id}><div className="enemy-card-heading"><div className="enemy-portrait-frame"><EnemyPortrait enemy={enemy}/></div><div><span className="enemy-area">LEVEL {enemy.level} · {enemy.boss?'BOSS':enemy.area.toUpperCase()}</span><h3>{enemy.name}</h3><span className="enemy-role">{enemy.role}</span></div></div><div className="enemy-guide-copy"><h4>How it works</h4><p>{enemy.mechanic}</p><h4>How to respond</h4><p>{enemy.counter}</p></div></article>)}</div>
      {!enemies.length&&<div className="guide-empty"><h3>No enemies found.</h3><p>Try another name, mechanic or level.</p><button className="secondary" onClick={()=>{setQuery('');setLevel(0);}}>Reset filters</button></div>}
    </>}
  </section>;
}
