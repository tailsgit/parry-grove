'use client';
/* eslint-disable react-hooks/purity -- The realtime controller reads its clock only in effects and event handlers, never during rendering. */
import { useEffect, useRef, useState } from 'react';
import { xpRequired, createGame, player, step, chooseUpgrade, move } from './engine.js';
import { WEAPONS, UPGRADES, COLORS, BALANCE, ENEMIES, isBoss, levelTheme } from './config.js';
import Settings from './Settings.jsx';
import { Renderer } from './renderer.js';
import { mouseButton, guardButton, resetGuard } from './input.js';

const emptyInput=()=>({mx:0,my:0,angle:0,attack:false,guard:false,parry:0,dash:0,interact:0});
export default function Game() {
  const canvas=useRef(null),renderer=useRef(null),world=useRef(null),input=useRef(emptyInput()),keys=useRef(new Set()),modeRef=useRef('menu'),net=useRef(null),pausedRef=useRef(false),cursor=useRef(null);
  const [mode,setMode]=useState('menu'),[view,setView]=useState(null),[room,setRoom]=useState(null),[weapon,setWeapon]=useState('sword'),[name,setName]=useState('Adventurer'),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[muted,setMuted]=useState(false),[paused,setPaused]=useState(false),[copied,setCopied]=useState(false),[latency,setLatency]=useState(0);
  const [myId,setMyId]=useState('solo'),[inventory,setInventory]=useState(false),[settings,setSettings]=useState(false);
  const soloInputs=useRef({solo:null}),displayRef=useRef({players:[]}),displayPlayers=useRef([]);
  const inventoryRef=useRef(false),inventoryWasPaused=useRef(false),inventoryDialog=useRef(null);
  const settingsRef=useRef(false),settingsWasPaused=useRef(false),settingsReturnFocus=useRef(null);
  const me=myId;const p=view?.players.find(p=>p.id===me),bosses=view?.enemies.filter(e=>isBoss(e.kind))||[];
  const isHost=room?.host===myId;
  function changeMode(m){settingsRef.current=false;setSettings(false);if(m==='menu'){pausedRef.current=false;setPaused(false);}inventoryRef.current=false;setInventory(false);modeRef.current=m;setMode(m);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;}
  function snapshot(g){if(g)setView({...g,players:g.players.map(p=>({...p})),enemies:g.enemies.map(e=>({...e}))});else setView(null);}
  function solo(){setMyId('solo');net.current=null;setRoom(null);input.current=emptyInput();pausedRef.current=false;setPaused(false);renderer.current?.unlockAudio();world.current=createGame([player('solo',name,weapon,0)]);snapshot(world.current);changeMode('solo');canvas.current?.focus();setError('');}
  async function request(payload,session=net.current) {
    const response=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...(session?{code:session.code,id:session.id,token:session.token}:{})})});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Connection failed. Please retry.'),{status:response.status});return data;
  }
  function accept(data){const s=net.current;if(!s||data.code!==s.code||data.revision<s.revision)return;if(s){s.revision=data.revision;s.lastSnapshot=performance.now();}setRoom(data);const starting=!world.current&&data.game;world.current=data.game;snapshot(data.game);if(starting){input.current=emptyInput();keys.current.clear();canvas.current?.focus();}}
  async function connect(action){if(busy)return;setBusy(true);setError('');renderer.current?.unlockAudio();try{const data=await request({action,name,weapon,code:code.trim().toUpperCase()},null);setMyId(data.session.id);net.current={...data.session,code:data.code,revision:-1,lastSnapshot:performance.now()};input.current=emptyInput();accept(data);changeMode('online');}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function command(action,extra={}){if(busy)return;setBusy(true);setError('');try{const data=await request({action,...extra});accept(data);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function leave(){const session=net.current;net.current=null;changeMode('menu');setRoom(null);setView(null);setError('');world.current=createGame([player('preview','',weapon)],314159);if(session)try{await request({action:'leave'},session);}catch{} }
  function pick(id){renderer.current?.unlockAudio();if(modeRef.current==='solo'){chooseUpgrade(world.current,'solo',id);snapshot(world.current);}else command('upgrade',{upgrade:id});}
  function next(){input.current.interact++;}
  function toggleInventory(){
    if(settingsRef.current||modeRef.current==='menu'||!world.current)return;
    const open=!inventoryRef.current;inventoryRef.current=open;setInventory(open);
    keys.current.clear();input.current.attack=false;resetGuard(input.current);
    if(modeRef.current==='solo'){
      if(open){inventoryWasPaused.current=pausedRef.current;pausedRef.current=true;}
      else pausedRef.current=inventoryWasPaused.current;
      setPaused(pausedRef.current);
    }
    if(!open)canvas.current?.focus();
  }
  function toggleSound(){const next=!renderer.current?.muted;setMuted(next);if(renderer.current)renderer.current.muted=next;}
  function closeSettings(){settingsRef.current=false;setSettings(false);if(modeRef.current==='solo'){pausedRef.current=settingsWasPaused.current;setPaused(pausedRef.current);}settingsReturnFocus.current?.focus();}
  function openSettings(){
    if(settingsRef.current){closeSettings();return;}
    if(inventoryRef.current)toggleInventory();
    settingsReturnFocus.current=document.activeElement;settingsRef.current=true;setSettings(true);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;
    if(modeRef.current==='solo'){settingsWasPaused.current=pausedRef.current;pausedRef.current=true;setPaused(true);}
  }
  useEffect(()=>{if(inventory)inventoryDialog.current?.focus();},[inventory]);
  function togglePause(){if(settingsRef.current||modeRef.current!=='solo')return;pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);keys.current.clear();input.current.attack=false;resetGuard(input.current);}
  useEffect(()=>{
    const draw=new Renderer(canvas.current);renderer.current=draw;world.current=createGame([player('preview','','sword')],314159);
    let frame,last=performance.now(),hud=0;
    const loop=(now)=>{
      const dt=Math.min((now-last)/1000,.05);last=now;const g=world.current;
      const i=input.current,k=keys.current;i.mx=(k.has('d')||k.has('arrowright')?1:0)-(k.has('a')||k.has('arrowleft')?1:0);i.my=(k.has('s')||k.has('arrowdown')?1:0)-(k.has('w')||k.has('arrowup')?1:0);
      if(g){const hero=g.players.find(p=>p.id===(net.current?.id||'solo'));if(hero&&cursor.current){const target=draw.world(cursor.current.x,cursor.current.y);i.angle=Math.atan2(target.y-hero.y,target.x-hero.x);}if(modeRef.current==='menu')g.time+=dt;else if(modeRef.current==='solo'&&!pausedRef.current){let left=dt;while(left>.0001){const d=Math.min(left,1/60);soloInputs.current.solo=i;step(g,soloInputs.current,d);left-=d;}}
        let display=g;
        // Short local extrapolation gives movement immediate visual response between snapshots.
        // Damage and collision outcomes still come exclusively from the shared server simulation.
        if(modeRef.current==='online'&&g.phase==='combat'){
          const id=net.current?.id,age=Math.min(.12,(now-(net.current?.lastSnapshot||now))/1000);
          display=displayRef.current;Object.assign(display,g);display.players=displayPlayers.current;display.players.length=g.players.length;
          for(let index=0;index<g.players.length;index++){const p=g.players[index];let copy=display.players[index];if(!copy)display.players[index]=copy={};Object.assign(copy,p);if(p.id===id&&p.hp>0){copy.angle=i.angle;const n=Math.hypot(i.mx,i.my)||1;move(g,copy,i.mx/n*BALANCE.speed*p.speed*age,i.my/n*BALANCE.speed*p.speed*age);}}
        }
        draw.draw(display,net.current?.id||'solo',dt,modeRef.current==='menu');
        if(now-hud>90&&modeRef.current==='solo'){snapshot(g);hud=now;}
      }
      frame=requestAnimationFrame(loop);
    };frame=requestAnimationFrame(loop);
    const down=e=>{if(settingsRef.current){if(e.key==='Escape'){e.preventDefault();if(!e.repeat)closeSettings();}return;}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const key=e.key.toLowerCase();if(key==='i'||(key==='escape'&&inventoryRef.current)){e.preventDefault();if(!e.repeat)toggleInventory();return;}if(inventoryRef.current){if(key==='tab'){const buttons=inventoryDialog.current?.querySelectorAll('button');if(buttons?.length){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}return;}if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();keys.current.add(key);if(e.repeat)return;if(key===' '){input.current.dash++;draw.unlockAudio();}if(key==='q'){guardButton(input.current,'keyboard',true);draw.unlockAudio();}if(key==='e')input.current.interact++;if(key==='escape'&&modeRef.current==='solo')togglePause();};
    const up=e=>{const key=e.key.toLowerCase();keys.current.delete(key);if(key==='q')guardButton(input.current,'keyboard',false);};const blur=()=>{keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;};
    const visibility=()=>{if(document.hidden){blur();if(modeRef.current==='solo'){pausedRef.current=true;setPaused(true);}}};
    const release=e=>mouseButton(input.current,e.button,false);
    window.addEventListener('mouseup',release);
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('mouseup',release);cancelAnimationFrame(frame);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);draw.audio?.close();};
  },[]);
  useEffect(()=>{
    if(mode!=='online')return;let ended=false,timer;
    const poll=async()=>{const s=net.current;if(ended||!s)return;const start=performance.now();try{const data=await request({action:world.current?'input':'poll',input:{...input.current}},s);if(!ended&&net.current===s){accept(data);setLatency(Math.round(performance.now()-start));setError('');}}catch(e){if(!ended){setError(e.status===401?e.message:'Reconnecting… '+e.message);if(e.status===401){net.current=null;changeMode('menu');world.current=createGame([player('preview','',weapon)],314159);}}}if(!ended)timer=setTimeout(poll,world.current?65:650);};poll();
    return()=>{ended=true;clearTimeout(timer);};
  // Session lifetime controls this poller. accept reads the current session from a ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode]);
  const aiming=e=>{cursor.current={x:e.clientX,y:e.clientY};const g=world.current,id=net.current?.id||'solo',hero=g?.players.find(p=>p.id===id);if(hero&&renderer.current){const pt=renderer.current.world(e.clientX,e.clientY);input.current.angle=Math.atan2(pt.y-hero.y,pt.x-hero.x);}};
  const mousedown=e=>{if(settingsRef.current||inventoryRef.current||pausedRef.current||modeRef.current==='menu'||(modeRef.current==='online'&&!world.current))return;e.preventDefault();canvas.current.focus();renderer.current?.unlockAudio();aiming(e);mouseButton(input.current,e.button,true);};
  const playing=!!view&&mode!=='menu',ended=playing&&['death','victory'].includes(view.phase),upgrade=playing&&view.phase==='upgrade';
  return <main className="game-screen">
    <div className="canvas-wrap immersive-screen">
      <canvas ref={canvas} tabIndex={0} onMouseMove={aiming} onMouseDown={mousedown} onMouseUp={e=>mouseButton(input.current,e.button,false)} onMouseLeave={()=>{input.current.attack=false;mouseButton(input.current,2,false);}} onContextMenu={e=>e.preventDefault()} aria-label="Game arena. WASD move, left click attack, right click or Q parry, hold to block, Space dash, I upgrades, E next room."/>
      <div className="screen-brand">✦ PARRY GROVE</div>
      <div className="screen-tools"><button onClick={openSettings}>Settings</button><button onClick={toggleSound} aria-label={muted?'Enable sound':'Mute sound'}>{muted?'Sound off':'Sound on'}</button>{playing&&<><button onClick={toggleInventory}>Upgrades · I <b>{p?.upgrades.length||0}</b></button>{mode==='solo'&&<button onClick={togglePause}>{paused?'Resume':'Pause · Esc'}</button>}<button onClick={leave}>Leave run</button></>}</div>
      {mode==='menu'&&<div className="screen-menu"><div className="menu-story"><span className="eyebrow">MELEE · DEFLECT · SURVIVE</span><h1>Good timing.<br/><em>Great trouble.</em></h1><p>Two levels. Ten rooms.<br/>Bring your blade. Bring your friends.</p><div className="parry-key"><span>● PERFECT</span><span>● REGULAR</span></div></div><div className="menu-card"><h2>Enter the grove.</h2><label className="field-label" htmlFor="name">ADVENTURER NAME</label><input id="name" value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="Your name"/><WeaponPicker weapon={weapon} setWeapon={setWeapon}/><button className="primary" onClick={solo}>Play solo ↗</button><div className="divider">OR BRING YOUR PARTY</div><button className="secondary" onClick={()=>connect('create')} disabled={busy}>{busy?'Connecting…':'Create co-op room ＋'}</button><form className="join-form" onSubmit={e=>{e.preventDefault();connect('join');}}><input aria-label="Six-character room code" placeholder="ROOM CODE" maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><button disabled={busy||code.length!==6} type="submit">JOIN ↗</button></form><p className="small-note">1–4 players · mouse and keyboard</p></div></div>}
      {mode==='online'&&!view&&<div className="screen-modal lobby-modal"><div className="lobby-content"><span className="eyebrow">YOUR PARTY</span><h1>Gather at the grove.</h1><div className="room-code" aria-label="Room code">{room?.code}<button onClick={async()=>{try{await navigator.clipboard.writeText(room.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Select and copy the room code.');}}}>{copied?'COPIED':'COPY'}</button></div><div className="party-list">{[0,1,2,3].map(slot=>{const member=room?.members.find(m=>m.slot===slot);return <div className="party-row" key={slot}><span className="player-square" style={{background:COLORS[slot]}}/><span>{member?member.name:'Waiting for player…'}<small>{member?`${WEAPONS[member.weapon].name}${member.id===room.host?' · Host':''}`:'Open slot'}</small></span><b className={member?.ready?'ready':'waiting'}>{member?(member.ready?'READY':'NOT READY'):'—'}</b></div>;})}</div></div><div className="menu-card"><h2>Pick your blade.</h2><WeaponPicker weapon={room?.members.find(m=>m.id===me)?.weapon||weapon} setWeapon={w=>command('weapon',{weapon:w})}/><button disabled={busy} className="primary" onClick={()=>command('ready')}>{room?.members.find(m=>m.id===me)?.ready?'Unready':'Ready up ✓'}</button>{isHost&&<button className="secondary" disabled={busy||!room?.members.every(m=>m.ready)} onClick={()=>command('start')}>Start the run ↗</button>}<button className="text-button" onClick={leave}>Leave lobby</button></div></div>}
      {playing&&p&&<div className="game-hud" aria-label="Player status"><div className="hud-name"><strong>{p.name}</strong><span>EXP LV {p.level} · {WEAPONS[p.weapon].name}</span></div><HudMeter label="HP" value={p.hp} max={p.maxHp}/><HudMeter label="SHIELD" value={100-(p.shieldDamage||0)} max={100} kind="shield"/><HudMeter label="INTERNAL" value={p.internal} max={100} kind="internal"/><div className="hud-exp">EXP {p.xp} / {xpRequired(p.level)}<i style={{width:`${p.xp/xpRequired(p.level)*100}%`}}/></div>{p.magnetLeft>0&&<div className="hud-warning" role="status">MAGNETIZED · {p.magnetLeft.toFixed(1)}s</div>}{p.shieldBroken&&<div className="hud-warning" role="status">SHIELD BROKEN</div>}{p.stun>0&&<div className="hud-warning" role="status">STUNNED · {p.stun.toFixed(1)}s</div>}</div>}
      {playing&&<div className="room-hud"><span>{levelTheme(view).name}</span><small>LEVEL {(view.stage??0)+1} · ROOM {view.room+1} / 5 · {view.enemies.length} ENEMIES</small><div className="boss-pair">{bosses.map(boss=><HudMeter key={boss.id} label={ENEMIES[boss.kind].name} value={boss.hp} max={boss.maxHp} kind="boss"/>)}</div></div>}
      {playing&&p&&<div className="action-hud"><span className={p.streak?'perfect-streak':''}>PERFECT ×{p.streak} {p.streak>0&&<small>+{Math.round(p.streak*BALANCE.streakBonus*100)}% DAMAGE</small>}</span><span>DASH <b>{p.dashCd>0?`${p.dashCd.toFixed(1)}s`:'READY'}</b></span><span>PARRY <b>{p.blocking?'BLOCKING':p.parryCd>0?`${p.parryCd.toFixed(1)}s`:'READY'}</b></span>{mode==='online'&&<span>{latency}ms · {view.players.filter(q=>q.hp>0).length} ALIVE</span>}</div>}
      {mode==='online'&&playing&&<div className="party-hud">{view.players.filter(q=>q.id!==me).map(q=><span key={q.id} style={{color:COLORS[q.slot]}}>■ {q.name} · {q.hp>0?`${Math.ceil(q.hp)} HP`:'DOWN'}</span>)}</div>}
      {paused&&mode==='solo'&&!inventory&&!settings&&!ended&&<div className="screen-modal centered"><span className="eyebrow">TAKE A BREATH</span><h2>Paused</h2><button className="primary" onClick={togglePause}>Resume run ↗</button><button className="secondary" onClick={toggleInventory}>View collected upgrades</button></div>}
      {playing&&view.phase==='levelclear'&&!inventory&&!paused&&<div className="screen-modal centered"><span className="eyebrow">LEVEL 1 COMPLETE</span><h2>Into the Foundry.</h2><p>Your health, stats, weapon and upgrades carry forward. Your shield fully restores.</p>{p?.hp>0?<button className="primary" onClick={next}>Enter Level 2 · E ↗</button>:<p>Waiting for your party to continue.</p>}<button className="secondary" onClick={toggleInventory}>Review upgrades</button></div>}
      {upgrade&&!inventory&&!paused&&<div className="screen-modal centered reward-modal"><span className="eyebrow">ROOM CLEARED</span><h2>Choose your reward.</h2>{p?.hp>0?<><div className="reward-grid">{p.offers.map(id=>{const u=UPGRADES.find(u=>u.id===id);return <button className="reward" key={id} disabled={p.chosen||busy} onClick={()=>pick(id)}><span>{u.icon}</span><div><b>{u.name}</b><small>{u.desc}</small></div></button>;})}</div>{p.chosen&&<p className="ready-note">{view.players.filter(q=>q.hp>0).every(q=>q.chosen)?<button className="primary" onClick={next}>Next room · E ↗</button>:'Waiting for your party…'}</p>}</>:<p>Your party chooses rewards. You revive next room.</p>}</div>}
      {inventory&&p&&<section className="screen-modal centered inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-title" tabIndex={-1} ref={inventoryDialog}><span className="eyebrow">YOUR RUN · LEVEL {p.level}</span><h2 id="inventory-title">Collected upgrades</h2><p>{mode==='online'?'Your co-op run keeps going while this panel is open.':'Your solo run is paused while you browse.'}</p><div className="inventory-grid">{UPGRADES.filter(u=>p.upgrades.includes(u.id)).map(u=><div className="collected-upgrade" key={u.id}><span>{u.icon}</span><div><b>{u.name} <small>×{p.upgrades.filter(id=>id===u.id).length}</small></b><p>{u.desc}</p></div></div>)}</div>{!p.upgrades.length&&<p>No upgrades yet. Clear a room to choose your first reward.</p>}<button className="primary" onClick={toggleInventory}>Back to game · I / Esc</button></section>}
      {ended&&!inventory&&<div className="screen-modal centered"><span className="eyebrow">{view.phase==='victory'?'BOTH LEVELS CLEARED':'EVERY RUN TEACHES SOMETHING'}</span><h2>{view.phase==='victory'?'Beautifully parried.':'Back to the roots.'}</h2><div className="result-stats"><span><b>{p?.kills||0}</b>KILLS</span><span><b>{p?.perfects||0}</b>PERFECT PARRIES</span><span><b>{p?.level||1}</b>LEVEL</span></div>{mode==='solo'?<button className="primary" onClick={solo}>Run it again ↗</button>:isHost?<button className="primary" disabled={busy} onClick={()=>command('return')}>Return party to lobby ↗</button>:<p>Waiting for the host.</p>}<button className="secondary" onClick={toggleInventory}>Review collected upgrades</button><button className="text-button" onClick={leave}>Leave to main menu</button></div>}
      {playing&&p?.hp<=0&&!ended&&<div className="spectator-banner">You’re down · revive at the next room</div>}
      {settings&&<Settings onClose={closeSettings} muted={muted} onToggleSound={toggleSound} online={mode==='online'}/>}
      {error&&<p role="alert" className="screen-error">{error}</p>}
      <div className="screen-controls">WASD move · LMB attack · Q / RMB parry & block · SPACE dash · I upgrades{mode==='online'?' · CO-OP':' · ESC pause'}</div>
    </div>
  </main>;
}
function WeaponPicker({weapon,setWeapon}){return <div className="weapons"><span className="field-label">CHOOSE YOUR WEAPON</span>{Object.entries(WEAPONS).map(([id,w],i)=><button key={id} className={`weapon ${weapon===id?'selected':''}`} onClick={()=>setWeapon(id)} aria-pressed={weapon===id}><span className="weapon-icon">{['†','⚔','╱'][i]}</span><div><b>{w.name}</b><small>{['Fast & precise','Balanced & versatile','Wide & forgiving'][i]}</small></div><span className="selection-dot"/><span className="weapon-tooltip">{w.desc}<br/>{w.perk}</span></button>)}</div>;}

function HudMeter({label,value,max,kind=''}){return <div className={`hud-meter ${kind}`}><div><span>{label}</span><b>{Math.ceil(value)} / {max}</b></div><div className={`meter ${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0,value)}><i style={{width:`${Math.max(0,Math.min(100,value/max*100))}%`}}/></div></div>;}
