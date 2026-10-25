'use client';
import {NET} from './net-protocol.js';
import {MultiplayerClient,savedSession,clearSession} from './multiplayer-client.js';
import {isEndless} from './endless.js';
import { PlayerHud, PerfectParryHud } from './CombatHud.jsx';
import RunPanels from './RunPanels.jsx';
import RewardCards, {RewardConfirmation} from './RewardCards.jsx';
import {UpgradeIcon,RarityBadge,EffectText} from './UpgradeVisual.jsx';
import {inventoryState,lobbyEquipment,UI_TIMING} from './ui-model.js';
import {rewardShortcut} from './reward-input.js';
import {createRun,claimKit,selectRoute,sacrifice,declineSacrifice,RUN_REWARDS,adminAddUpgrade,adminRemoveUpgrade,adminAddCurse,adminRemoveCurse} from './run-content.js';
import { useEffect, useRef, useState } from 'react';
import { SoloHitPause } from './hit-pause.js';
import { createGame, player, chooseUpgrade, adminTeleport, adminHealth, adminLevel } from './engine.js';
import { UPGRADES, COLORS, BALANCE, ENEMIES, isBoss, levelTheme } from './config.js';
import Tutorial from './Tutorial.jsx';
import {DEV_TOOLS,readPreferences} from './preferences.js';
import Settings from './Settings.jsx';
import { Renderer } from './renderer.js';
import { mouseButton, guardButton, resetGuard } from './input.js';

const emptyInput=()=>({mx:0,my:0,angle:0,attack:false,attackPress:0,guard:false,parry:0,dash:0,interact:0});
export default function Game() {
  const canvas=useRef(null),renderer=useRef(null),world=useRef(null),input=useRef(emptyInput()),keys=useRef(new Set()),heldKeys=useRef(new Set()),suppressedKeys=useRef(new Set()),modeRef=useRef('menu'),net=useRef(null),pausedRef=useRef(false),cursor=useRef(null);
  const [mode,setMode]=useState('menu'),[view,setView]=useState(null),[room,setRoom]=useState(null),[weapon]=useState('sword'),[name,setName]=useState('Adventurer'),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[muted,setMuted]=useState(false),[paused,setPaused]=useState(false),[copied,setCopied]=useState(false),[latency,setLatency]=useState(0);
  const [selectedRunType,setSelectedRunType]=useState('story');
  const [myId,setMyId]=useState('solo'),[inventory,setInventory]=useState(false),[settings,setSettings]=useState(false);
  const [practice,setPractice]=useState(false),[offerPractice,setOfferPractice]=useState(false),[preferences,setPreferences]=useState({volume:1,reduced:false,showName:false});
  const practiceRef=useRef(false),offerDialog=useRef(null);
  useEffect(()=>{if(offerPractice)offerDialog.current?.querySelector('button')?.focus();},[offerPractice]);
  useEffect(()=>{queueMicrotask(()=>{const value=readPreferences();setPreferences(value);renderer.current?.setPreferences(value);document.documentElement.dataset.reducedMotion=String(value.reduced);});},[]);
  function configure(value){setPreferences(value);renderer.current?.setPreferences(value);localStorage.setItem('parry-grove-preferences',JSON.stringify(value));document.documentElement.dataset.reducedMotion=String(value.reduced);}
  function startPractice(){if(modeRef.current!=='menu')return;closeSettings();practiceRef.current=true;setPractice(true);setOfferPractice(false);}
  function finishPractice(){if(!localStorage.getItem('parry-grove-practice'))localStorage.setItem('parry-grove-practice','skipped');practiceRef.current=false;setPractice(false);}
  function playSolo(){if(!localStorage.getItem('parry-grove-practice'))setOfferPractice(true);else solo();}
  const [endedAt,setEndedAt]=useState(null),[rewardSelection,setRewardSelection]=useState(null),[inventoryFromMenu,setInventoryFromMenu]=useState(false);
  const selectionRef=useRef(null),transitionUntil=useRef(0),rewardDialog=useRef(null),inventoryReturnFocus=useRef(null);

  const soloHitPause=useRef(new SoloHitPause());
  const soloInputs=useRef({solo:null});
  const inventoryRef=useRef(false),inventoryWasPaused=useRef(false),inventoryDialog=useRef(null),pauseDialog=useRef(null);
  const settingsRef=useRef(false),settingsWasPaused=useRef(false),settingsReturnFocus=useRef(null);
  useEffect(()=>{if(!rewardSelection)return;let timer;const finish=()=>{const g=world.current,hero=g?.players.find(p=>p.id===(net.current?.id||'solo'));if(modeRef.current==='online'&&g?.phase==='upgrade'&&!hero?.chosen){timer=setTimeout(finish,60);return;}selectionRef.current=null;setRewardSelection(null);keys.current.clear();input.current.attack=false;resetGuard(input.current);if(!inventoryRef.current&&!settingsRef.current&&!pausedRef.current)canvas.current?.focus();};timer=setTimeout(finish,UI_TIMING.confirm);return()=>clearTimeout(timer);},[rewardSelection]);
  const me=myId;const p=view?.players.find(p=>p.id===me),bosses=view?.enemies.filter(e=>isBoss(e.kind))||[];
  const isHost=room?.host===myId;
  function changeMode(m){selectionRef.current=null;setRewardSelection(null);transitionUntil.current=0;soloHitPause.current.reset();settingsRef.current=false;setSettings(false);pausedRef.current=false;setPaused(false);inventoryRef.current=false;setInventory(false);modeRef.current=m;setMode(m);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;}
  function snapshot(g){if(g&&['death','victory'].includes(g.phase))setEndedAt(previous=>previous??g.events?.findLast(e=>e.kind===g.phase)?.time??g.time);else setEndedAt(null);if(g)setView({...g,players:g.players.map(p=>({...p})),enemies:g.enemies.map(e=>({...e}))});else setView(null);}
  function solo(){setMyId('solo');net.current?.stop();clearSession();net.current=null;setRoom(null);input.current=emptyInput();pausedRef.current=false;setPaused(false);renderer.current?.unlockAudio();world.current=createRun([player('solo',name,weapon,0)],undefined,selectedRunType);snapshot(world.current);changeMode('solo');canvas.current?.focus();setError('');}
  async function request(payload,session=net.current) {
    const response=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:NET.version,...payload,...(session?{code:session.code,id:session.id,token:session.token}:{})})});
    let data;const jsonResponse=response.clone();
    try{data=await response.json();}
    catch{const body=(await jsonResponse.text()).trim();const detail=body.startsWith('<')?'HTML response':`invalid response${body?`: ${body.slice(0,100)}`:''}`;throw Object.assign(new Error(`Room API returned an ${detail} (HTTP ${response.status}).`),{status:response.status});}
    if(!response.ok)throw Object.assign(new Error(data.error||'Connection failed. Please retry.'),{status:response.status});return data;
  }
  function accept(data){if(data.runType)setSelectedRunType(data.runType);if(!net.current||data.code!==net.current.code)return;
    setRoom(data);world.current=data.game;snapshot(data.game);
  }
  function attachClient(session,initial){
    net.current?.stop();world.current=null;snapshot(null);input.current=emptyInput();setMyId(session.id);
    const client=new MultiplayerClient(session,{onSnapshot:accept,onError:setError,onLatency:setLatency,onStartup:kind=>renderer.current?.sound(kind),
      syncInput:hero=>{input.current=emptyInput();const i=input.current;i.parry=hero?.seenParry||0;i.dash=hero?.seenDash||0;i.attackPress=hero?.seenAttack||0;i.interact=hero?.seenInteract||0;keys.current.clear();},
      onCorrection:()=>{renderer.current?.feedback.reset();},
      onInvalid:message=>{net.current=null;changeMode('menu');world.current=createGame([player('preview','',weapon)],314159);setRoom(null);setView(null);setError(message);}});
    net.current=client;changeMode('online');client.start(initial).catch(e=>setError(e.message));canvas.current?.focus();return client;
  }
  async function connect(action){if(busy)return;setBusy(true);setError('');renderer.current?.unlockAudio();try{const data=await request({action,name,weapon,runType:selectedRunType,code:code.trim().toUpperCase()},null);attachClient({...data.session,code:data.code},data);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function command(action,extra={}){if(busy)return;setBusy(true);setError('');try{await net.current?.action(action,extra);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function leave(){const client=net.current;clearSession();try{await client?.leave();}catch{}net.current=null;changeMode('menu');setRoom(null);setView(null);setError('');world.current=createGame([player('preview','',weapon)],314159);}
  function pick(id){const g=world.current,hero=g?.players.find(p=>p.id===(net.current?.id||'solo'));if(selectionRef.current||g?.phase!=='upgrade'||!hero||hero.chosen||hero.hp<=0||!hero.offers.includes(id))return;const choice={id,offers:[...hero.offers],room:g.room,stage:g.stage};selectionRef.current=choice;suppressedKeys.current=new Set(heldKeys.current);transitionUntil.current=performance.now()+UI_TIMING.confirm;setRewardSelection(choice);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;renderer.current?.unlockAudio();if(modeRef.current==='solo'){chooseUpgrade(g,'solo',id);snapshot(g);}else net.current.action('upgrade',{upgrade:id}).catch(e=>{selectionRef.current=null;setRewardSelection(null);setError(e.message);});}
  async function runAction(action,extra={}){
    try{setError('');if(modeRef.current==='solo'){
      const g=world.current;if(action==='kit')claimKit(g,'solo',extra.kit);if(action==='route')selectRoute(g,'solo',extra.choice);if(action==='sacrifice')sacrifice(g,'solo',extra.item);if(action==='sacrificeDecline')declineSacrifice(g,'solo');if(action==='vendorClose'){const p=g.players[0];p.vendorOpen=false;p.altarOpen=false;}snapshot(g);
    }else await net.current.action(action,extra);
    }catch(e){setError(e.message);}
  }
  async function admin(operation,values){
    const hacker=world.current?.players.find(player=>player.id===(net.current?.id||'solo'))?.name?.trim().toLowerCase()==='hacker';
    if(!DEV_TOOLS&&!(modeRef.current==='solo'&&hacker))throw Error('Developer controls are disabled.');
    if(modeRef.current==='solo'){
      if(operation==='teleport'){adminTeleport(world.current,values.level,values.room);soloHitPause.current.reset();const i=input.current;world.current.players.forEach(p=>{p.seenParry=i.parry;p.seenDash=i.dash;p.seenAttack=i.attackPress;p.seenInteract=i.interact;});}
      else if(operation==='health')adminHealth(world.current,'solo',values.hp);
      else if(operation==='level')adminLevel(world.current,'solo',values.level);
      else {const p=world.current.players.find(player=>player.id==='solo');if(operation==='upgradeAdd')adminAddUpgrade(p,values.upgrade);else if(operation==='upgradeRemove')adminRemoveUpgrade(p,values.upgrade);else if(operation==='curseAdd')adminAddCurse(p,values.curse,values.rarity,(world.current.stage||0)*BALANCE.encounters+world.current.room,isEndless(world.current));else if(operation==='curseRemove')adminRemoveCurse(p,values.index);else throw Error('Unknown admin action.');}
      keys.current.clear();input.current.mx=0;input.current.my=0;input.current.attack=false;resetGuard(input.current);snapshot(world.current);
    }else if(modeRef.current==='online')await net.current.action('admin',{operation,...values});
    else throw Error('Start a run before using admin controls.');
  }
  function next(){input.current.interact++;}
  function toggleInventory(){
    if(settingsRef.current||modeRef.current==='menu'||!world.current)return;const hero=world.current.players.find(p=>p.id===(net.current?.id||'solo'));if(hero?.vendorOpen||hero?.altarOpen)return;
    const open=!inventoryRef.current;if(open){inventoryReturnFocus.current=document.activeElement;setInventoryFromMenu(pausedRef.current);}inventoryRef.current=open;setInventory(open);if(!open&&['death','victory','levelclear'].includes(world.current.phase)){pausedRef.current=false;setPaused(false);inventoryWasPaused.current=false;}
    keys.current.clear();input.current.attack=false;resetGuard(input.current);
    if(modeRef.current==='solo'&&!['death','victory'].includes(world.current.phase)){
      if(open){inventoryWasPaused.current=pausedRef.current;pausedRef.current=true;}
      else pausedRef.current=inventoryWasPaused.current;
      setPaused(pausedRef.current);
    }
    if(!open){if(inventoryWasPaused.current)inventoryReturnFocus.current?.focus();else canvas.current?.focus();}
  }
  function toggleSound(){const next=!renderer.current?.muted;setMuted(next);if(renderer.current)renderer.current.muted=next;}
  function closeSettings(){settingsRef.current=false;setSettings(false);if(modeRef.current==='solo'){pausedRef.current=settingsWasPaused.current;setPaused(pausedRef.current);}settingsReturnFocus.current?.focus();}
  function openSettings(){
    if(settingsRef.current){closeSettings();return;}
    if(inventoryRef.current)toggleInventory();
    settingsReturnFocus.current=document.activeElement;settingsRef.current=true;setSettings(true);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;
    if(modeRef.current==='solo'&&!['death','victory'].includes(world.current?.phase)){settingsWasPaused.current=pausedRef.current;pausedRef.current=true;setPaused(true);}
  }
  useEffect(()=>{if(inventory)inventoryDialog.current?.focus();},[inventory]);
  useEffect(()=>{if(view?.phase==='upgrade'&&!inventory&&!settings&&!paused)rewardDialog.current?.querySelector('button:not(:disabled)')?.focus();},[view?.phase,inventory,settings,paused]);
  useEffect(()=>{if(['death','victory'].includes(view?.phase)&&!inventory&&!paused&&!settings)requestAnimationFrame(()=>document.querySelector('.results-modal .primary')?.focus());},[view?.phase,inventory,paused,settings]);
  useEffect(()=>{if(paused&&!inventory&&!settings)pauseDialog.current?.focus();},[paused,inventory,settings]);
  function togglePause(){if(['death','victory'].includes(world.current?.phase)&&!pausedRef.current)return;if(settingsRef.current||inventoryRef.current||modeRef.current==='menu'||!world.current)return;pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);keys.current.clear();input.current.mx=0;input.current.my=0;input.current.attack=false;resetGuard(input.current);if(!pausedRef.current)canvas.current?.focus();}
  useEffect(()=>{
    const draw=new Renderer(canvas.current);draw.observeMotion();draw.setPreferences(readPreferences());renderer.current=draw;world.current=createGame([player('preview','','sword')],314159);
    let frame,last=performance.now(),hud=0,lastPerfects=-1;
    const loop=(now)=>{
      if(practiceRef.current){last=now;frame=requestAnimationFrame(loop);return;}
      const dt=Math.min((now-last)/1000,.05);last=now;const g=world.current;
      const i=input.current,k=keys.current;i.mx=(k.has('d')||k.has('arrowright')?1:0)-(k.has('a')||k.has('arrowleft')?1:0);i.my=(k.has('s')||k.has('arrowdown')?1:0)-(k.has('w')||k.has('arrowup')?1:0);if(pausedRef.current||inventoryRef.current||settingsRef.current||(transitionUntil.current>now&&g?.phase!=='combat')){i.mx=0;i.my=0;i.attack=false;resetGuard(i);}
      let renderDt=dt;
      if(g){const hero=g.players.find(p=>p.id===(net.current?.id||'solo'));if(hero&&cursor.current){const target=draw.world(cursor.current.x,cursor.current.y);i.angle=Math.atan2(target.y-hero.y,target.x-hero.x);}if(modeRef.current==='menu')g.time+=dt;else if(modeRef.current==='solo'){renderDt=0;if(!pausedRef.current){soloInputs.current.solo=i;renderDt=soloHitPause.current.advance(g,soloInputs.current,dt,'solo');}}
        let display=g;
        if(modeRef.current==='online'&&net.current){net.current.frame(dt,i);display=net.current.display(now,i);}
        draw.draw(display,net.current?.id||'solo',renderDt,modeRef.current==='menu');
        if(modeRef.current==='online')net.current?.acknowledgeEvents(draw.lastEvent);
        if(modeRef.current==='solo'&&(now-hud>90||hero?.perfects!==lastPerfects)){snapshot(g);hud=now;lastPerfects=hero?.perfects;}
      }
      frame=requestAnimationFrame(loop);
    };frame=requestAnimationFrame(loop);
    const down=e=>{if(practiceRef.current)return;heldKeys.current.add(e.key.toLowerCase());if(suppressedKeys.current.has(e.key.toLowerCase())){e.preventDefault();return;}if(transitionUntil.current>performance.now()&&world.current?.phase!=='combat'){suppressedKeys.current.add(e.key.toLowerCase());if([' ' ,'1','2','3','e'].includes(e.key.toLowerCase()))e.preventDefault();return;}if(settingsRef.current){if(e.key==='Escape'){e.preventDefault();if(!e.repeat)closeSettings();}return;}const hero=world.current?.players.find(p=>p.id===(net.current?.id||'solo'));if(hero?.vendorOpen||hero?.altarOpen){if(e.key==='Escape')runAction('vendorClose');return;}const key=e.key.toLowerCase();if(pausedRef.current&&!inventoryRef.current){if(key==='escape'){e.preventDefault();if(!e.repeat)togglePause();}if(key==='tab'){const buttons=pauseDialog.current?.querySelectorAll('button');if(buttons?.length&&document.activeElement===(e.shiftKey?buttons[0]:buttons[buttons.length-1])){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}return;}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(document.activeElement?.tagName==='BUTTON'&&[' ','enter'].includes(key))return;if(key==='i'||(key==='escape'&&inventoryRef.current)){e.preventDefault();if(!e.repeat)toggleInventory();return;}if(inventoryRef.current){if(key==='tab'){const buttons=inventoryDialog.current?.querySelectorAll('button');if(buttons?.length){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}return;}if(world.current?.phase==='upgrade'&&/^[123]$/.test(key)){e.preventDefault();const id=rewardShortcut(world.current,net.current?.id||'solo',key,e.repeat);if(id)pick(id);return;}if(world.current?.phase==='upgrade'){if(key==='escape')togglePause();return;}if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();keys.current.add(key);if(e.repeat)return;if(key===' '){input.current.dash++;draw.unlockAudio();}if(key==='q'){guardButton(input.current,'keyboard',true);draw.unlockAudio();}if(key==='e')input.current.interact++;if(key==='escape'){e.preventDefault();togglePause();}};
    const up=e=>{const key=e.key.toLowerCase();heldKeys.current.delete(key);suppressedKeys.current.delete(key);keys.current.delete(key);if(key==='q')guardButton(input.current,'keyboard',false);};const blur=()=>{heldKeys.current.clear();suppressedKeys.current.clear();keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;if(modeRef.current==='solo'){const i=input.current;world.current?.players.forEach(p=>{p.dashBufferLeft=0;p.parryBufferLeft=0;p.meleeBufferLeft=0;p.seenDash=i.dash;p.seenParry=i.parry;p.seenAttack=i.attackPress;});if(!pausedRef.current){pausedRef.current=true;setPaused(true);}}};
    const visibility=()=>{if(document.hidden)blur();};
    const release=e=>mouseButton(input.current,e.button,false);
    window.addEventListener('mouseup',release);
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('mouseup',release);cancelAnimationFrame(frame);draw.dispose();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};
  // The controller reads current mode/session/world refs; keep one input listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{const session=savedSession();let cancelled=false;if(session)queueMicrotask(()=>{if(!cancelled)attachClient(session);});return()=>{cancelled=true;net.current?.stop();};
  // Session recovery runs once after the renderer is initialized.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const aiming=e=>{cursor.current={x:e.clientX,y:e.clientY};const g=world.current,id=net.current?.id||'solo',hero=g?.players.find(p=>p.id===id);if(hero&&renderer.current){const pt=renderer.current.world(e.clientX,e.clientY);input.current.angle=Math.atan2(pt.y-hero.y,pt.x-hero.x);}};
  const mousedown=e=>{if(transitionUntil.current>performance.now()&&world.current?.phase!=='combat')return;if(p?.vendorOpen||p?.altarOpen||settingsRef.current||inventoryRef.current||pausedRef.current||modeRef.current==='menu'||(modeRef.current==='online'&&!world.current))return;e.preventDefault();canvas.current.focus();renderer.current?.unlockAudio();aiming(e);mouseButton(input.current,e.button,true);};
  const deathInfo=view?.phase==='death'?p?.deathInfo:null;
  const rewardEvent=view?.events?.findLast(e=>e.kind==='upgrade'&&e.who===me&&view.time-e.time<.75);
  const playing=!!view&&mode!=='menu',ended=playing&&['death','victory'].includes(view.phase),upgrade=playing&&view.phase==='upgrade';
  const summaryTime=deathInfo?.time??endedAt??view?.time??0;
  const inventoryCopy=inventoryState(view?.phase,mode==='online',inventoryFromMenu);
  const selectedReward=rewardSelection&&view?.room===rewardSelection.room&&view?.stage===rewardSelection.stage&&!['combat','death','victory'].includes(view?.phase)?rewardSelection:null;
  return <main className="game-screen" onClickCapture={e=>{const button=e.target.closest?.('button');if(button&&!button.disabled&&!button.classList.contains('upgrade-card'))renderer.current?.sound('ui',.6);}}>
    <div className="canvas-wrap immersive-screen">
      {practice&&<Tutorial onFinish={finishPractice} preferences={preferences}/>}
      <canvas ref={canvas} tabIndex={0} onMouseMove={aiming} onMouseDown={mousedown} onMouseUp={e=>mouseButton(input.current,e.button,false)} onMouseLeave={()=>{input.current.attack=false;mouseButton(input.current,2,false);}} onContextMenu={e=>e.preventDefault()} aria-label="Game arena. WASD move, left click attack, right click or Q parry, hold to block, Space dash, I upgrades, E interact."/>
      {!playing&&<div className="screen-brand">✦ PARRY GROVE</div>}
      {!playing&&<div className="screen-tools"><button onClick={openSettings}>Settings</button><button onClick={toggleSound} aria-label={muted?'Enable sound':'Mute sound'}>{muted?'Sound off':'Sound on'}</button></div>}
      {mode==='menu'&&<div className="screen-menu"><div className="menu-story"><span className="eyebrow">MELEE · DEFLECT · SURVIVE</span><h1>Good timing.<br/><em>Great trouble.</em></h1><p>{selectedRunType==='endless'?<>No final room. Survive as long as you can.<br/>New threats. A shop every five clears.</>:<>Three levels. Fifteen rooms.<br/>Bring your blade. Bring your friends.</>}</p><div className="parry-key"><span>● PERFECT</span><span>● REGULAR</span></div></div><div className="menu-card"><h2>Choose your route.</h2><div className="run-mode-options" aria-label="Run mode">{[['story','Story','Three areas. Boss encounters. A final victory.'],['endless','Endless','Survive unlimited rooms. Shop every five clears.']].map(([type,title,description])=><button key={type} className={`run-mode-card${selectedRunType===type?' is-selected':''}`} aria-pressed={selectedRunType===type} onClick={()=>setSelectedRunType(type)}><strong>{title}</strong><small>{description}</small></button>)}</div><label className="field-label" htmlFor="name">ADVENTURER NAME</label><input id="name" value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="Your name"/><p className="small-note">Choose your weapon kit from physical pickups when the run begins.</p><button className="primary" onClick={playSolo}>Play solo ↗</button><button className="text-button" onClick={startPractice}>Combat practice</button><div className="divider">OR BRING YOUR PARTY</div><button className="secondary" onClick={()=>connect('create')} disabled={busy}>{busy?'Connecting…':'Create co-op room ＋'}</button><form className="join-form" onSubmit={e=>{e.preventDefault();connect('join');}}><input aria-label="Six-character room code" placeholder="ROOM CODE" maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><button disabled={busy||code.length!==6} type="submit">JOIN ↗</button></form><p className="small-note">1–4 players · mouse and keyboard</p></div></div>}
      {mode==='online'&&!view&&<div className="screen-modal lobby-modal"><div className="lobby-content"><span className="eyebrow">YOUR PARTY · MODE: {(room?.runType||'story').toUpperCase()}</span><h1>Gather at the grove.</h1><div className="room-code" aria-label="Room code">{room?.code}<button onClick={async()=>{try{await navigator.clipboard.writeText(room.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Select and copy the room code.');}}}>{copied?'COPIED':'COPY'}</button></div><div className="party-list">{[0,1,2,3].map(slot=>{const member=room?.members.find(m=>m.slot===slot);return <div className="party-row" key={slot}><span className="player-square" style={{background:COLORS[slot]}}/><span>{member?member.name:'Waiting for player…'}<small>{member?lobbyEquipment(member,room.host,view):'Open slot'}</small></span><b className={member?.ready?'ready':'waiting'}>{member?(member.ready?'READY':'NOT READY'):'—'}</b></div>;})}</div></div><div className="menu-card"><h2>Prepare to draft.</h2><p>First to grab a kit gets it. Each player chooses one exclusive pickup in the starting room.</p><button disabled={busy} className="primary" onClick={()=>command('ready')}>{room?.members.find(m=>m.id===me)?.ready?'Unready':'Ready up ✓'}</button>{isHost&&<button className="secondary" disabled={busy||!room?.members.every(m=>m.ready)} onClick={()=>command('start')}>Start the run ↗</button>}<button className="text-button" onClick={leave}>Leave lobby</button></div></div>}
      <div className="arena-ui">
      {playing&&rewardEvent&&!paused&&!inventory&&!settings&&<RewardConfirmation event={rewardEvent}/>}
      {playing&&p&&<PlayerHud player={p} scrap={view.runSystems?view.scrap:null} network={mode==='online'?`${latency}ms · ${view.players.filter(q=>q.hp>0).length} ALIVE`:null}/>}
      {playing&&p&&view.phase==='combat'&&!paused&&!inventory&&!settings&&<PerfectParryHud player={p}/>}

      {playing&&<div className="room-hud"><span>{levelTheme(view).name}</span><small>{isEndless(view)?`ENDLESS · ${view.phase==='shop'?'SHOP':view.phase==='altar'?'SACRIFICE':`ROOM ${view.combatRoom}`}`:`LEVEL ${(view.stage??0)+1} · ROOM ${view.room+1} / 5`} · {view.phase==='draft'?'KIT DRAFT':view.phase==='route'?'EXITS OPEN':['shop','altar'].includes(view.phase)?'EXTRA STOP':`${view.enemies.length} ${view.enemies.length===1?'ENEMY':'ENEMIES'}`}</small>{isEndless(view)&&view.phase==='combat'&&view.remainingSpawnGroups>0&&<small className="reinforcement-status">Reinforcements remaining · {view.spawnWarnings?.length?`${view.spawnWarnings.length} arriving`:'clear space for the next group'}</small>}</div>}

      {playing&&bosses.length>0&&!settings&&!inventory&&!paused&&<section className="boss-hud" aria-label="Boss status">{view.intro>0&&<strong className="boss-entrance">BOSS APPROACHING</strong>}{bosses.map(boss=><HudMeter key={boss.id} label={ENEMIES[boss.kind].name} value={boss.hp} max={boss.maxHp} kind="boss"/>)}</section>}
      {mode==='online'&&playing&&<div className="party-hud">{view.players.filter(q=>q.id!==me).map(q=><span key={q.id} style={{color:COLORS[q.slot]}}>■ {q.name} · {q.hp>0?`${Math.ceil(q.hp)} HP`:'DOWN'}</span>)}</div>}
      </div>
      {playing&&paused&&!inventory&&!settings&&<section className="screen-modal centered pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title" tabIndex={-1} ref={pauseDialog}><span className="eyebrow">TAKE A BREATH</span><h2 id="pause-title">{ended?'Run ended':mode==='solo'?'Paused':'Run menu'}</h2>{mode==='online'&&!ended&&<p>The shared game continues while this menu is open.</p>}<button className="primary" onClick={togglePause}>{ended?'Back to results · Esc':'Resume · Esc'}</button><button className="secondary" onClick={toggleInventory}>Collected upgrades</button><button className="secondary" onClick={openSettings}>Settings & enemy guide</button><button className="secondary" onClick={toggleSound}>{muted?'Enable sound':'Mute sound'}</button><button className="text-button" onClick={leave}>Leave run</button></section>}
      {playing&&view.phase==='levelclear'&&!inventory&&!paused&&<div className="screen-modal centered"><span className="eyebrow">LEVEL {(view.stage??0)+1} COMPLETE</span><h2>{(view.stage??0)===0?'Into the Foundry.':'Into the Irradiated Works.'}</h2><p>Your health, stats, weapon and upgrades carry forward. Your shield fully restores.</p>{p?.hp>0?<button className="primary" onClick={next}>Enter Level {(view.stage??0)+2} · E ↗</button>:<p>Waiting for your party to continue.</p>}<button className="secondary" onClick={toggleInventory}>Review upgrades</button></div>}
      {(upgrade||selectedReward)&&!inventory&&!paused&&!settings&&<div className="screen-modal centered reward-modal" ref={rewardDialog} role="dialog" aria-modal="true" aria-label="Choose a room reward" tabIndex={-1} onKeyDown={e=>{if(e.key==='Tab'){const buttons=[...rewardDialog.current.querySelectorAll('button:not(:disabled)')];e.preventDefault();if(buttons.length){const index=buttons.indexOf(document.activeElement);buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}}}}><span className="eyebrow">ROOM CLEARED</span><h2>Choose your reward.</h2>{p?.hp>0?<><RewardCards offers={selectedReward?.offers||p.offers} disabled={!!selectedReward||p.chosen||busy} selectedId={selectedReward?.id||(p.chosen?p.upgrades.at(-1):null)} onPick={pick}/>{(p.chosen||selectedReward)&&<p className="ready-note" role="status">{view.players.filter(q=>q.hp>0).every(q=>q.chosen)?'Exits opening…':'Waiting for your party…'}</p>}</>:<p>Your party chooses rewards. You revive next room.</p>}</div>}
      {inventory&&p&&<section className="screen-modal centered inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-title" tabIndex={-1} ref={inventoryDialog}><span className="eyebrow">{inventoryCopy.status} · PLAYER LEVEL {p.level}</span><h2 id="inventory-title">Collected upgrades</h2><p>{inventoryCopy.description}</p><div className="inventory-grid">{(isEndless(view)?RUN_REWARDS:UPGRADES).filter(u=>p.upgrades.includes(u.id)).map(u=><div className="collected-upgrade" key={u.id}><span className="inventory-icon"><UpgradeIcon id={u.id}/></span><div><b>{u.name} <small>×{p.upgrades.filter(id=>id===u.id).length}</small></b><RarityBadge rarity={u.rarity}/><p><EffectText text={u.desc}/></p></div></div>)}{(p.curses||[]).filter(c=>c.combatClearsLeft!=null?c.combatClearsLeft>0:c.expiresAtRoom>=(view.stage??0)*BALANCE.encounters+view.room).map((curse,index)=><div className="collected-upgrade curse-entry" key={`${curse.id}-${index}`}><span className="inventory-icon"><UpgradeIcon id="vampire"/></span><div><b>{curse.name}</b><small className="rarity-tag">CURSE · {curse.combatClearsLeft??Math.max(1,curse.expiresAtRoom-(view.stage??0)*BALANCE.encounters-view.room+1)} ROOMS LEFT · {curse.rarity}</small><p>{curse.description}</p></div></div>)}</div>{!p.upgrades.length&&!(p.curses||[]).length&&<p>{ended?'No upgrades were collected this run.':'No upgrades yet. Clear a room to choose your first reward.'}</p>}<button className="primary" onClick={toggleInventory}>{inventoryCopy.back} · I / Esc</button></section>}
      {ended&&!inventory&&!paused&&!settings&&<div className="screen-modal centered results-modal" role="dialog" aria-label="Run results" tabIndex={-1}><span className="eyebrow">{view.phase==='victory'?'ALL THREE LEVELS CLEARED':'EVERY RUN TEACHES SOMETHING'}</span><h2>{view.phase==='victory'?'Beautifully parried.':'Back to the roots.'}</h2><div className="result-stats"><span><b>{isEndless(view)?view.runStats.totalKills:p?.kills||0}</b>KILLS</span><span><b>{isEndless(view)?view.runStats.perfectParries:p?.perfects||0}</b>PERFECT PARRIES</span><span><b>{p?.level||1}</b>PLAYER LEVEL</span></div>{isEndless(view)?<p>ENDLESS · {view.runStats.roomsCleared} rooms cleared · Room {view.runStats.highestRoomReached} reached · {Math.floor(view.runStats.survivalTimeMs/60000)}m {Math.floor(view.runStats.survivalTimeMs/1000)%60}s survived</p>:<p>Area {deathInfo?.area??(view.stage??0)+1} · Room {deathInfo?.room??view.room+1} reached · {Math.floor(summaryTime/60)}m {Math.floor(summaryTime%60)}s survived</p>}{view.phase==='death'&&<p>Cause: {deathInfo?.cause||'Unknown combat damage'}</p>}{mode==='solo'?<button className="primary" onClick={solo}>Run it again ↗</button>:isHost?<button className="primary" disabled={busy} onClick={()=>command(isEndless(view)?'retry':'return')}>{isEndless(view)?'Retry Endless with party ↗':'Return party to lobby ↗'}</button>:<p>Waiting for the host.</p>}<button className="secondary" onClick={toggleInventory}>Review collected upgrades</button><button className="text-button" onClick={leave}>Leave to main menu</button></div>}
      {playing&&p?.hp<=0&&!ended&&<div className="spectator-banner">You’re down · revive at the next room</div>}
      {playing&&view.runSystems&&!settings&&!inventory&&!paused&&<RunPanels game={view} player={p} host={mode==='solo'||isHost} action={runAction}/>}
      {settings&&<Settings onClose={closeSettings} muted={muted} onToggleSound={toggleSound} online={mode==='online'} phase={view?.phase} active={playing&&!ended} isHost={isHost} player={p} runType={view?.runType} combatRoom={view?.combatRoom} stage={view?.stage??0} room={view?.room??0} onAdmin={admin} preferences={preferences} onPreferences={configure} onPractice={startPractice}/>}
      {offerPractice&&<section className="screen-modal centered" role="dialog" aria-modal="true" aria-label="Optional combat practice" ref={offerDialog} onKeyDown={e=>{if(e.key==='Escape'){setOfferPractice(false);e.stopPropagation();}if(e.key==='Tab'){const buttons=[...offerDialog.current.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}}}><h2>Learn the rhythm?</h2><p>A short, safe practice teaches parries and blocking. Replay anytime from the menu.</p><button className="primary" onClick={startPractice}>Practice first</button><button className="secondary" onClick={()=>{localStorage.setItem('parry-grove-practice','skipped');setOfferPractice(false);solo();}}>Skip · start run</button></section>}
      {playing&&!ended&&!inventory&&!settings&&!paused&&view.events?.findLast(e=>e.kind==='kitpickup'&&e.who===me&&view.time-e.time<2.5)&&<div className="equipment-confirmation" role="status">{view.events.findLast(e=>e.kind==='kitpickup'&&e.who===me).text}</div>}
      {error&&<p role="alert" className="screen-error">{error}</p>}

    </div>
  </main>;
}

function HudMeter({label,value,max,kind=''}){return <div className={`hud-meter ${kind}`}><div><span>{label}</span><b>{Math.ceil(value)} / {Math.ceil(max)}</b></div><div className={`meter ${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0,value)}><i style={{width:`${Math.max(0,Math.min(100,value/max*100))}%`}}/></div></div>;}
