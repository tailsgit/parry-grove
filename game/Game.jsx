'use client';
import RunPanels from './RunPanels.jsx';
import RewardCards from './RewardCards.jsx';
import {rewardShortcut} from './reward-input.js';
import {createRun,claimKit,selectRoute,sacrifice} from './run-content.js';
import { useEffect, useRef, useState } from 'react';
import { SoloHitPause } from './hit-pause.js';
import { xpRequired, createGame, player, chooseUpgrade, adminTeleport, adminHealth, move } from './engine.js';
import { WEAPONS, UPGRADES, COLORS, BALANCE, ENEMIES, isBoss, levelTheme } from './config.js';
import Settings from './Settings.jsx';
import { Renderer } from './renderer.js';
import { mouseButton, guardButton, resetGuard } from './input.js';

const emptyInput=()=>({mx:0,my:0,angle:0,attack:false,guard:false,parry:0,dash:0,interact:0});
export default function Game() {
  const canvas=useRef(null),renderer=useRef(null),world=useRef(null),input=useRef(emptyInput()),keys=useRef(new Set()),modeRef=useRef('menu'),net=useRef(null),realtime=useRef(null),pausedRef=useRef(false),cursor=useRef(null);
  const [mode,setMode]=useState('menu'),[view,setView]=useState(null),[room,setRoom]=useState(null),[weapon]=useState('sword'),[name,setName]=useState('Adventurer'),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[muted,setMuted]=useState(false),[paused,setPaused]=useState(false),[copied,setCopied]=useState(false),[latency,setLatency]=useState(0);
  const [myId,setMyId]=useState('solo'),[inventory,setInventory]=useState(false),[settings,setSettings]=useState(false);
  const soloHitPause=useRef(new SoloHitPause());
  const soloInputs=useRef({solo:null}),displayRef=useRef({players:[]});
  const inventoryRef=useRef(false),inventoryWasPaused=useRef(false),inventoryDialog=useRef(null),pauseDialog=useRef(null);
  const settingsRef=useRef(false),settingsWasPaused=useRef(false),settingsReturnFocus=useRef(null);
  const me=myId;const p=view?.players.find(p=>p.id===me),bosses=view?.enemies.filter(e=>isBoss(e.kind))||[];
  const isHost=room?.host===myId;
  function changeMode(m){soloHitPause.current.reset();settingsRef.current=false;setSettings(false);pausedRef.current=false;setPaused(false);inventoryRef.current=false;setInventory(false);modeRef.current=m;setMode(m);keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;}
  function snapshot(g){if(g)setView({...g,players:g.players.map(p=>({...p})),enemies:g.enemies.map(e=>({...e}))});else setView(null);}
  function solo(){setMyId('solo');net.current=null;setRoom(null);input.current=emptyInput();pausedRef.current=false;setPaused(false);renderer.current?.unlockAudio();world.current=createRun([player('solo',name,weapon,0)]);snapshot(world.current);changeMode('solo');canvas.current?.focus();setError('');}
  async function request(payload,session=net.current) {
    const response=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...(session?{code:session.code,id:session.id,token:session.token}:{})})});
    let data;const jsonResponse=response.clone();
    try{data=await response.json();}
    catch{const body=(await jsonResponse.text()).trim();const detail=body.startsWith('<')?'HTML response':`invalid response${body?`: ${body.slice(0,100)}`:''}`;throw Object.assign(new Error(`Room API returned an ${detail} (HTTP ${response.status}).`),{status:response.status});}
    if(!response.ok)throw Object.assign(new Error(data.error||'Connection failed. Please retry.'),{status:response.status});return data;
  }
  function accept(data,realtimeSnapshot=false){const s=net.current;if(!s||data.code!==s.code)return;if(data.game&&!s.hadGame){s.socketSequence=-1;s.snapshots=[];}if(realtimeSnapshot){if(data.sequence<(s.socketSequence??-1))return;s.socketSequence=data.sequence;}else if(data.revision<s.revision)return;if(s){if(!realtimeSnapshot)s.revision=data.revision;s.lastSnapshot=performance.now();s.hadGame=Boolean(data.game);if(data.game){s.snapshots??=[];s.snapshots.push({at:s.lastSnapshot,game:data.game});if(s.snapshots.length>5)s.snapshots.shift();}else{s.socketSequence=-1;s.snapshots=[];}}setRoom(data);const starting=!world.current&&data.game;world.current=data.game;snapshot(data.game);if(starting){input.current=emptyInput();keys.current.clear();canvas.current?.focus();}}
  async function connect(action){if(busy)return;setBusy(true);setError('');renderer.current?.unlockAudio();try{const data=await request({action,name,weapon,code:code.trim().toUpperCase()},null);setMyId(data.session.id);net.current={...data.session,code:data.code,revision:-1,lastSnapshot:performance.now()};input.current=emptyInput();accept(data);changeMode('online');}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function command(action,extra={}){if(modeRef.current==='online'&&['return','upgrade'].includes(action)){if(realtime.current?.readyState===WebSocket.OPEN){realtime.current.send(JSON.stringify({type:'action',action,...extra}));setError('');}else setError('Reconnecting to the room…');return;}if(busy)return;setBusy(true);setError('');try{const data=await request({action,...extra});accept(data);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function leave(){const session=net.current,socket=realtime.current;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'action',action:'leave'}));net.current=null;changeMode('menu');setRoom(null);setView(null);setError('');world.current=createGame([player('preview','',weapon)],314159);if(session&&socket?.readyState!==WebSocket.OPEN)try{await request({action:'leave'},session);}catch{} }
  function pick(id){renderer.current?.unlockAudio();if(modeRef.current==='solo'){chooseUpgrade(world.current,'solo',id);snapshot(world.current);}else if(realtime.current?.readyState===WebSocket.OPEN)realtime.current.send(JSON.stringify({type:'action',action:'upgrade',upgrade:id}));else setError('Reconnecting to the room…');}
  async function runAction(action,extra={}){
    try{setError('');if(modeRef.current==='solo'){
      const g=world.current;if(action==='kit')claimKit(g,'solo',extra.kit);if(action==='route')selectRoute(g,'solo',extra.choice);if(action==='sacrifice')sacrifice(g,'solo',extra.item);if(action==='vendorClose'){const p=g.players[0];p.vendorOpen=false;p.altarOpen=false;}snapshot(g);
    }else{const data=await request({action,...extra});if(net.current)net.current.snapshots=[];accept(data,typeof data.sequence==='number');}
    }catch(e){setError(e.message);}
  }
  async function admin(operation,values){
    if(modeRef.current==='solo'){
      if(operation==='teleport'){adminTeleport(world.current,values.level,values.room);soloHitPause.current.reset();const i=input.current;world.current.players.forEach(p=>{p.seenParry=i.parry;p.seenDash=i.dash;p.seenInteract=i.interact;});}
      else adminHealth(world.current,'solo',values.hp);
      keys.current.clear();input.current.mx=0;input.current.my=0;input.current.attack=false;resetGuard(input.current);snapshot(world.current);
    }else if(modeRef.current==='online'){const data=await request({action:'admin',operation,...values});if(net.current)net.current.snapshots=[];accept(data,typeof data.sequence==='number');}
    else throw Error('Start a run before using admin controls.');
  }
  function next(){input.current.interact++;}
  function toggleInventory(){
    if(settingsRef.current||modeRef.current==='menu'||!world.current)return;const hero=world.current.players.find(p=>p.id===(net.current?.id||'solo'));if(hero?.vendorOpen||hero?.altarOpen)return;
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
  useEffect(()=>{if(paused&&!inventory&&!settings)pauseDialog.current?.focus();},[paused,inventory,settings]);
  function togglePause(){if(settingsRef.current||inventoryRef.current||modeRef.current==='menu'||!world.current)return;pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);keys.current.clear();input.current.mx=0;input.current.my=0;input.current.attack=false;resetGuard(input.current);if(!pausedRef.current)canvas.current?.focus();}
  useEffect(()=>{
    const draw=new Renderer(canvas.current);renderer.current=draw;world.current=createGame([player('preview','','sword')],314159);
    let frame,last=performance.now(),hud=0;
    const loop=(now)=>{
      const dt=Math.min((now-last)/1000,.05);last=now;const g=world.current;
      const i=input.current,k=keys.current;i.mx=(k.has('d')||k.has('arrowright')?1:0)-(k.has('a')||k.has('arrowleft')?1:0);i.my=(k.has('s')||k.has('arrowdown')?1:0)-(k.has('w')||k.has('arrowup')?1:0);if(pausedRef.current||inventoryRef.current||settingsRef.current){i.mx=0;i.my=0;i.attack=false;resetGuard(i);}
      let renderDt=dt;
      if(g){const hero=g.players.find(p=>p.id===(net.current?.id||'solo'));if(hero&&cursor.current){const target=draw.world(cursor.current.x,cursor.current.y);i.angle=Math.atan2(target.y-hero.y,target.x-hero.x);}if(modeRef.current==='menu')g.time+=dt;else if(modeRef.current==='solo'){renderDt=0;if(!pausedRef.current){soloInputs.current.solo=i;renderDt=soloHitPause.current.advance(g,soloInputs.current,dt,'solo');}}
        let display=g;
        // Short local extrapolation gives movement immediate visual response between snapshots.
        // Damage and collision outcomes still come exclusively from the shared server simulation.
        if(modeRef.current==='online'&&g.phase==='combat'){
          const id=net.current?.id,age=Math.min(.12,(now-(net.current?.lastSnapshot||now))/1000),snapshots=net.current?.snapshots||[],renderAt=now-100;
          let before=snapshots[0],after=snapshots[snapshots.length-1];
          for(const item of snapshots){if(item.at<=renderAt)before=item;if(item.at>=renderAt){after=item;break;}}
          const span=(after?.at||0)-(before?.at||0),blend=before&&after&&span>0?Math.max(0,Math.min(1,(renderAt-before.at)/span)):1;
          display=displayRef.current;
          // Keep reusable render buffers separate from authoritative snapshots.
          // Interpolation and prediction below mutate these display copies.
          const renderBuffers={players:display.players,enemies:display.enemies,bullets:display.bullets,hazards:display.hazards};
          Object.assign(display,g);
          for(const key of Object.keys(renderBuffers))display[key]=renderBuffers[key]||[];
          const interpolateEntities=(key,current)=>{
            let output=display[key];if(!output||output===current){output=current.map(item=>({...item}));display[key]=output;}const older=before?.game?.[key]||[],newer=after?.game?.[key]||[],oldById=new Map(older.map(item=>[item.id,item])),newById=new Map(newer.map(item=>[item.id,item]));
            output.length=current.length;
            for(let index=0;index<current.length;index++){
              const value=current[index],copy=output[index]||(output[index]={}),a=oldById.get(value.id),b=newById.get(value.id);Object.assign(copy,value);
              if(a&&b){for(const field of ['x','y','sx','sy','ex','ey'])if(Number.isFinite(a[field])&&Number.isFinite(b[field]))copy[field]=a[field]+(b[field]-a[field])*blend;if(Number.isFinite(a.angle)&&Number.isFinite(b.angle)){const delta=Math.atan2(Math.sin(b.angle-a.angle),Math.cos(b.angle-a.angle));copy.angle=a.angle+delta*blend;}}
            }
            return output;
          };
          display.players=interpolateEntities('players',g.players);display.enemies=interpolateEntities('enemies',g.enemies);display.bullets=interpolateEntities('bullets',g.bullets);display.hazards=interpolateEntities('hazards',g.hazards);
          for(const copy of display.players){if(copy.id===id&&copy.hp>0){const source=g.players.find(p=>p.id===id);if(source){Object.assign(copy,source);copy.angle=i.angle;const n=Math.hypot(i.mx,i.my)||1;move(g,copy,i.mx/n*BALANCE.speed*source.speed*age,i.my/n*BALANCE.speed*source.speed*age);}}}
        }
        draw.draw(display,net.current?.id||'solo',renderDt,modeRef.current==='menu');
        if(now-hud>90&&modeRef.current==='solo'){snapshot(g);hud=now;}
      }
      frame=requestAnimationFrame(loop);
    };frame=requestAnimationFrame(loop);
    const down=e=>{if(settingsRef.current){if(e.key==='Escape'){e.preventDefault();if(!e.repeat)closeSettings();}return;}const hero=world.current?.players.find(p=>p.id===(net.current?.id||'solo'));if(hero?.vendorOpen||hero?.altarOpen){if(e.key==='Escape')runAction('vendorClose');return;}const key=e.key.toLowerCase();if(pausedRef.current&&!inventoryRef.current){if(key==='escape'){e.preventDefault();if(!e.repeat)togglePause();}if(key==='tab'){const buttons=pauseDialog.current?.querySelectorAll('button');if(buttons?.length&&document.activeElement===(e.shiftKey?buttons[0]:buttons[buttons.length-1])){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}return;}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(key==='i'||(key==='escape'&&inventoryRef.current)){e.preventDefault();if(!e.repeat)toggleInventory();return;}if(inventoryRef.current){if(key==='tab'){const buttons=inventoryDialog.current?.querySelectorAll('button');if(buttons?.length){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}return;}if(world.current?.phase==='upgrade'&&/^[123]$/.test(key)){e.preventDefault();const id=rewardShortcut(world.current,net.current?.id||'solo',key,e.repeat);if(id)pick(id);return;}if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();keys.current.add(key);if(e.repeat)return;if(key===' '){input.current.dash++;draw.unlockAudio();}if(key==='q'){guardButton(input.current,'keyboard',true);draw.unlockAudio();}if(key==='e')input.current.interact++;if(key==='escape'){e.preventDefault();togglePause();}};
    const up=e=>{const key=e.key.toLowerCase();keys.current.delete(key);if(key==='q')guardButton(input.current,'keyboard',false);};const blur=()=>{keys.current.clear();input.current.attack=false;resetGuard(input.current);input.current.mx=0;input.current.my=0;};
    const visibility=()=>{if(document.hidden){blur();if(modeRef.current==='solo'){pausedRef.current=true;setPaused(true);}}};
    const release=e=>mouseButton(input.current,e.button,false);
    window.addEventListener('mouseup',release);
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('mouseup',release);cancelAnimationFrame(frame);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);draw.audio?.close();};
  // The controller reads current mode/session/world refs; keep one input listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const onlineGame=mode==='online'&&Boolean(view);
  useEffect(()=>{
    if(mode!=='online'||onlineGame)return;let stopped=false,timer;
    const poll=async()=>{const s=net.current;if(stopped||!s)return;try{const data=await request({action:'poll'},s);if(!stopped&&net.current===s){accept(data);setError('');}}catch(e){if(!stopped){setError(e.status===401?e.message:'Reconnecting… '+e.message);if(e.status===401){net.current=null;changeMode('menu');world.current=createGame([player('preview','',weapon)],314159);}}}if(!stopped)timer=setTimeout(poll,400);};poll();
    return()=>{stopped=true;clearTimeout(timer);};
  // Lobby session lifetime controls this poller.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode,onlineGame]);
  useEffect(()=>{
    if(!onlineGame||!net.current)return;let stopped=false,socket=null,retryTimer,inputTimer,pingTimer,fallbackTimer,retry=250,authenticated=false,fallbackBusy=false;
    const session=net.current;
    const fallback=async()=>{if(stopped)return;if((!socket||socket.readyState!==WebSocket.OPEN||!authenticated)&&!fallbackBusy&&net.current===session){fallbackBusy=true;try{const data=await request({action:'input',input:{...input.current}},session);if(!stopped&&net.current===session)accept(data,typeof data.sequence==='number');}catch(e){if(!stopped){setError(e.status===401?e.message:'Reconnecting… '+e.message);if(e.status===401){net.current=null;changeMode('menu');world.current=createGame([player('preview','',weapon)],314159);}}}finally{fallbackBusy=false;}}if(!stopped)fallbackTimer=window.setTimeout(fallback,65);};
    const open=()=>{
      if(stopped||net.current!==session)return;
      authenticated=false;const protocol=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${protocol}//${location.host}/api/room/socket?code=${encodeURIComponent(session.code)}`);realtime.current=socket;
      socket.onopen=()=>{socket.send(JSON.stringify({type:'auth',id:session.id,token:session.token}));inputTimer=window.setInterval(()=>{if(authenticated&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'input',input:{...input.current}}));},33);pingTimer=window.setInterval(()=>{if(authenticated&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping',sentAt:performance.now()}));},2000);};
      socket.onmessage=event=>{if(realtime.current!==socket)return;try{const message=JSON.parse(event.data);if(message.type==='snapshot'){authenticated=true;retry=250;accept(message,true);setError('');setBusy(false);}else if(message.type==='pong'&&Number.isFinite(message.sentAt))setLatency(Math.round(performance.now()-message.sentAt));else if(message.type==='error'){setError(message.message||'Room connection failed.');if(message.fatal)socket.close(4008,'Room session rejected');}}catch(error){console.error('Invalid room update:',error);setError(`Room update failed: ${error instanceof Error?error.message:'Invalid message.'}`);}};
      socket.onerror=()=>setError('Realtime connection interrupted. Reconnecting…');
      socket.onclose=event=>{if(inputTimer)clearInterval(inputTimer);if(pingTimer)clearInterval(pingTimer);if(realtime.current===socket)realtime.current=null;if(event.code===4008){net.current=null;changeMode('menu');world.current=createGame([player('preview','',weapon)],314159);return;}if(!stopped){setError('Realtime connection interrupted. Reconnecting…');retryTimer=window.setTimeout(open,retry);retry=Math.min(2000,retry*2);}};
    };
    open();fallback();return()=>{stopped=true;if(retryTimer)clearTimeout(retryTimer);if(fallbackTimer)clearTimeout(fallbackTimer);if(inputTimer)clearInterval(inputTimer);if(pingTimer)clearInterval(pingTimer);if(realtime.current===socket)realtime.current=null;if(socket&&socket.readyState<WebSocket.CLOSING)socket.close(1000,'Client leaving');};
  // accept reads the current network session from a ref; onlineGame changes only on lobby/run transitions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[onlineGame]);
  const aiming=e=>{cursor.current={x:e.clientX,y:e.clientY};const g=world.current,id=net.current?.id||'solo',hero=g?.players.find(p=>p.id===id);if(hero&&renderer.current){const pt=renderer.current.world(e.clientX,e.clientY);input.current.angle=Math.atan2(pt.y-hero.y,pt.x-hero.x);}};
  const mousedown=e=>{if(p?.vendorOpen||p?.altarOpen||settingsRef.current||inventoryRef.current||pausedRef.current||modeRef.current==='menu'||(modeRef.current==='online'&&!world.current))return;e.preventDefault();canvas.current.focus();renderer.current?.unlockAudio();aiming(e);mouseButton(input.current,e.button,true);};
  const playing=!!view&&mode!=='menu',ended=playing&&['death','victory'].includes(view.phase),upgrade=playing&&view.phase==='upgrade';
  return <main className="game-screen">
    <div className="canvas-wrap immersive-screen">
      <canvas ref={canvas} tabIndex={0} onMouseMove={aiming} onMouseDown={mousedown} onMouseUp={e=>mouseButton(input.current,e.button,false)} onMouseLeave={()=>{input.current.attack=false;mouseButton(input.current,2,false);}} onContextMenu={e=>e.preventDefault()} aria-label="Game arena. WASD move, left click attack, right click or Q parry, hold to block, Space dash, I upgrades, E interact."/>
      {!playing&&<div className="screen-brand">✦ PARRY GROVE</div>}
      {!playing&&<div className="screen-tools"><button onClick={openSettings}>Settings</button><button onClick={toggleSound} aria-label={muted?'Enable sound':'Mute sound'}>{muted?'Sound off':'Sound on'}</button></div>}
      {mode==='menu'&&<div className="screen-menu"><div className="menu-story"><span className="eyebrow">MELEE · DEFLECT · SURVIVE</span><h1>Good timing.<br/><em>Great trouble.</em></h1><p>Two levels. Ten rooms.<br/>Bring your blade. Bring your friends.</p><div className="parry-key"><span>● PERFECT</span><span>● REGULAR</span></div></div><div className="menu-card"><h2>Enter the grove.</h2><label className="field-label" htmlFor="name">ADVENTURER NAME</label><input id="name" value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="Your name"/><p className="small-note">Choose your weapon kit from physical pickups when the run begins.</p><button className="primary" onClick={solo}>Play solo ↗</button><div className="divider">OR BRING YOUR PARTY</div><button className="secondary" onClick={()=>connect('create')} disabled={busy}>{busy?'Connecting…':'Create co-op room ＋'}</button><form className="join-form" onSubmit={e=>{e.preventDefault();connect('join');}}><input aria-label="Six-character room code" placeholder="ROOM CODE" maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><button disabled={busy||code.length!==6} type="submit">JOIN ↗</button></form><p className="small-note">1–4 players · mouse and keyboard</p></div></div>}
      {mode==='online'&&!view&&<div className="screen-modal lobby-modal"><div className="lobby-content"><span className="eyebrow">YOUR PARTY</span><h1>Gather at the grove.</h1><div className="room-code" aria-label="Room code">{room?.code}<button onClick={async()=>{try{await navigator.clipboard.writeText(room.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Select and copy the room code.');}}}>{copied?'COPIED':'COPY'}</button></div><div className="party-list">{[0,1,2,3].map(slot=>{const member=room?.members.find(m=>m.slot===slot);return <div className="party-row" key={slot}><span className="player-square" style={{background:COLORS[slot]}}/><span>{member?member.name:'Waiting for player…'}<small>{member?`${WEAPONS[member.weapon].name}${member.id===room.host?' · Host':''}`:'Open slot'}</small></span><b className={member?.ready?'ready':'waiting'}>{member?(member.ready?'READY':'NOT READY'):'—'}</b></div>;})}</div></div><div className="menu-card"><h2>Prepare to draft.</h2><p>First to grab a kit gets it. Each player chooses one exclusive pickup in the starting room.</p><button disabled={busy} className="primary" onClick={()=>command('ready')}>{room?.members.find(m=>m.id===me)?.ready?'Unready':'Ready up ✓'}</button>{isHost&&<button className="secondary" disabled={busy||!room?.members.every(m=>m.ready)} onClick={()=>command('start')}>Start the run ↗</button>}<button className="text-button" onClick={leave}>Leave lobby</button></div></div>}
      <div className="arena-ui">
      {playing&&p&&<div className="game-hud" aria-label="Player status"><div className="hud-name"><strong>{p.name}</strong><span>EXP LV {p.level} · {WEAPONS[p.weapon].name}</span></div><HudMeter label="HP" value={p.hp} max={p.maxHp}/><HudMeter label="SHIELD" value={100-(p.shieldDamage||0)} max={100} kind="shield"/><HudMeter label="INTERNAL" value={p.internal} max={100} kind="internal"/><div className="hud-exp">EXP {p.xp} / {xpRequired(p.level)}<i style={{width:`${p.xp/xpRequired(p.level)*100}%`}}/></div>{p.magnetLeft>0&&<div className="hud-warning" role="status">MAGNETIZED · {p.magnetLeft.toFixed(1)}s</div>}{p.shieldBroken&&<div className="hud-warning" role="status">SHIELD BROKEN</div>}{p.stun>0&&<div className="hud-warning" role="status">STUNNED · {p.stun.toFixed(1)}s</div>}<div className="hud-actions"><span>DASH <b>{p.dashCd>0?`${p.dashCd.toFixed(1)}s`:'READY'}</b></span><span>PARRY <b>{p.blocking?'BLOCKING':p.parryCd>0?`${p.parryCd.toFixed(1)}s`:'READY'}</b></span><span className={p.streak?'perfect-streak':''}>PERFECT <b>×{p.streak}</b>{p.streak>0&&<small>+{Math.round(p.streak*BALANCE.streakBonus*100)}% DAMAGE</small>}</span>{mode==='online'&&<small>{latency}ms · {view.players.filter(q=>q.hp>0).length} ALIVE</small>}</div></div>}
      {playing&&<div className="room-hud"><span>{levelTheme(view).name}</span><small>LEVEL {(view.stage??0)+1} · ROOM {view.room+1} / 5 · {view.phase==='draft'?'KIT DRAFT':view.phase==='route'?'EXITS OPEN':['shop','altar'].includes(view.phase)?'EXTRA STOP':`${view.enemies.length} ENEMIES`}</small>{view.runSystems&&<strong className="scrap-count">SCRAP {view.scrap} · SHARED</strong>}<div className="boss-pair">{bosses.map(boss=><HudMeter key={boss.id} label={ENEMIES[boss.kind].name} value={boss.hp} max={boss.maxHp} kind="boss"/>)}</div></div>}

      {mode==='online'&&playing&&<div className="party-hud">{view.players.filter(q=>q.id!==me).map(q=><span key={q.id} style={{color:COLORS[q.slot]}}>■ {q.name} · {q.hp>0?`${Math.ceil(q.hp)} HP`:'DOWN'}</span>)}</div>}
      </div>
      {playing&&paused&&!inventory&&!settings&&<section className="screen-modal centered pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title" tabIndex={-1} ref={pauseDialog}><span className="eyebrow">TAKE A BREATH</span><h2 id="pause-title">{mode==='solo'?'Paused':'Run menu'}</h2>{mode==='online'&&<p>The shared game continues while this menu is open.</p>}<button className="primary" onClick={togglePause}>Resume · Esc</button><button className="secondary" onClick={toggleInventory}>Collected upgrades</button><button className="secondary" onClick={openSettings}>Settings & enemy guide</button><button className="secondary" onClick={toggleSound}>{muted?'Enable sound':'Mute sound'}</button><button className="text-button" onClick={leave}>Leave run</button></section>}
      {playing&&view.phase==='levelclear'&&!inventory&&!paused&&<div className="screen-modal centered"><span className="eyebrow">LEVEL 1 COMPLETE</span><h2>Into the Foundry.</h2><p>Your health, stats, weapon and upgrades carry forward. Your shield fully restores.</p>{p?.hp>0?<button className="primary" onClick={next}>Enter Level 2 · E ↗</button>:<p>Waiting for your party to continue.</p>}<button className="secondary" onClick={toggleInventory}>Review upgrades</button></div>}
      {upgrade&&!inventory&&!paused&&<div className="screen-modal centered reward-modal"><span className="eyebrow">ROOM CLEARED</span><h2>Choose your reward.</h2>{p?.hp>0?<><RewardCards offers={p.offers} disabled={p.chosen||busy} onPick={pick}/>{p.chosen&&<p className="ready-note">{view.players.filter(q=>q.hp>0).every(q=>q.chosen)?'Exits opening…':'Waiting for your party…'}</p>}</>:<p>Your party chooses rewards. You revive next room.</p>}</div>}
      {inventory&&p&&<section className="screen-modal centered inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-title" tabIndex={-1} ref={inventoryDialog}><span className="eyebrow">YOUR RUN · LEVEL {p.level}</span><h2 id="inventory-title">Collected upgrades</h2><p>{mode==='online'?'Your co-op run keeps going while this panel is open.':'Your solo run is paused while you browse.'}</p><div className="inventory-grid">{UPGRADES.filter(u=>p.upgrades.includes(u.id)).map(u=><div className="collected-upgrade" key={u.id}><span>{u.icon}</span><div><b>{u.name} <small>×{p.upgrades.filter(id=>id===u.id).length}</small></b><p>{u.desc}</p></div></div>)}</div>{!p.upgrades.length&&<p>No upgrades yet. Clear a room to choose your first reward.</p>}<button className="primary" onClick={toggleInventory}>Back to game · I / Esc</button></section>}
      {ended&&!inventory&&!paused&&!settings&&<div className="screen-modal centered"><span className="eyebrow">{view.phase==='victory'?'BOTH LEVELS CLEARED':'EVERY RUN TEACHES SOMETHING'}</span><h2>{view.phase==='victory'?'Beautifully parried.':'Back to the roots.'}</h2><div className="result-stats"><span><b>{p?.kills||0}</b>KILLS</span><span><b>{p?.perfects||0}</b>PERFECT PARRIES</span><span><b>{p?.level||1}</b>LEVEL</span></div>{mode==='solo'?<button className="primary" onClick={solo}>Run it again ↗</button>:isHost?<button className="primary" disabled={busy} onClick={()=>command('return')}>Return party to lobby ↗</button>:<p>Waiting for the host.</p>}<button className="secondary" onClick={toggleInventory}>Review collected upgrades</button><button className="text-button" onClick={leave}>Leave to main menu</button></div>}
      {playing&&p?.hp<=0&&!ended&&<div className="spectator-banner">You’re down · revive at the next room</div>}
      {playing&&view.runSystems&&!settings&&!inventory&&!paused&&<RunPanels game={view} player={p} host={mode==='solo'||isHost} action={runAction}/>}
      {settings&&<Settings onClose={closeSettings} muted={muted} onToggleSound={toggleSound} online={mode==='online'} active={playing} isHost={isHost} player={p} stage={view?.stage??0} room={view?.room??0} onAdmin={admin}/>}
      {error&&<p role="alert" className="screen-error">{error}</p>}

    </div>
  </main>;
}

function HudMeter({label,value,max,kind=''}){return <div className={`hud-meter ${kind}`}><div><span>{label}</span><b>{Math.ceil(value)} / {max}</b></div><div className={`meter ${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0,value)}><i style={{width:`${Math.max(0,Math.min(100,value/max*100))}%`}}/></div></div>;}
