import {LEVELS} from './config.js';
// Endless tuning is independent of Story balance and progression.
export const ENDLESS=Object.freeze({baseBudget:4,budgetSlope:1.1,blockBudget:.7,hpPerRoom:.12,damageRate:.04,damageCap:2.5,enemies:8,partyEnemies:2,supports:2,denial:2,projectiles:96,totalProjectiles:160,hazards:48,reinforceTime:20,spawnTell:1.5,spawnDistance:150,sacrificeChance:.1,doorTime:2,doorRadius:78,eliteStart:16,eliteChance:.04,elitePerRoom:.002,eliteMax:.18,eliteHealth:1.3,eliteDamage:1.1});
export const isEndless=g=>g?.runType==='endless';
export function runType(value='story'){if(!['story','endless'].includes(value))throw Error('Choose Story or Endless.');return value;}
export function stream(seed,room,purpose){let s=(seed^Math.imul(room,0x9e3779b1))>>>0;for(const ch of purpose)s=Math.imul(s^ch.charCodeAt(0),16777619)>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
export function endlessDifficulty(room,party=1){return {budget:Math.floor((ENDLESS.baseBudget+ENDLESS.budgetSlope*room+ENDLESS.blockBudget*Math.floor(room/5)**2)*(1+.45*(party-1))),health:1+ENDLESS.hpPerRoom*(room-1),damage:1+(ENDLESS.damageCap-1)*(1-Math.exp(-ENDLESS.damageRate*(room-1)/(ENDLESS.damageCap-1))),cap:ENDLESS.enemies+ENDLESS.partyEnemies*(party-1)};}
export function endlessTheme(seed,room){const block=Math.floor((room-1)/5);return block<3?block:Math.floor(stream(seed,block,'theme')()*3);}
export const ENEMY_COSTS={brawler:2,bow:2,pistol:2,lancer:3,homing:3,shotgun:3,mortar:5,railgun:5,miner:4,ricochet:3,suicide:4,cluster:4,magnet:4,sine:3,riot:4,boomerang:4,poisoner:5,wallmaker:5,sticky:4,flamethrower:4,saw:4,digger:4};
export const roles=kind=>({frontline:['brawler','lancer','riot','suicide','saw','digger'].includes(kind),support:['riot','magnet','wallmaker'].includes(kind),denial:['miner','mortar','cluster','poisoner','wallmaker','sticky','flamethrower'].includes(kind)});
export function unlockedEnemies(room){return LEVELS.slice(0,room<6?1:room<11?2:3).flatMap(l=>l.enemies).filter(k=>ENEMY_COSTS[k]&&(!(room<3)||['brawler','bow','pistol'].includes(k))&&(!(room<4)||!['mortar','railgun','homing'].includes(k)));}
export function endlessRoutes(seed,room,last=-99){if(room%5===0)return ['shop'];return room>=3&&room-last>=4&&stream(seed,room,'route')()<ENDLESS.sacrificeChance?['continue','altar']:['continue'];}
export function initializeEndless(g,seed){g.runSeed=seed>>>0;g.combatRoom=1;g.roomPhase='combat';g.lastShopRoom=0;g.lastSacrificeRoom=-99;g.runStats={roomsCleared:0,highestRoomReached:1,survivalTimeMs:0,totalKills:0,perfectParries:0};}
export function prepareEndlessRoom(g){
 g.seed=Math.floor(stream(g.runSeed,g.combatRoom,'layout')()*4294967296)>>>0;g.stage=endlessTheme(g.runSeed,g.combatRoom);g.room=0;g.roomPhase='combat';g.difficulty=endlessDifficulty(g.combatRoom,g.players.length);g.difficultyBudget=g.difficulty.budget;
 // Lazy generation keeps the queue bounded even in arbitrarily late rooms.
 g.endlessEliteGiven=false;g.spawnBudget=g.difficultyBudget;g.spawnSerial=0;g.spawnWarnings=[];g.spawnClock=0;g.remainingSpawnGroups=1;g.availableExits=[];g.doorConsensus=null;g.pendingCombatRoom=undefined;g.runStats.highestRoomReached=Math.max(g.runStats.highestRoomReached,g.combatRoom);
}
function safeSpawn(g,x,y,reserved){return x>60&&y>60&&x<g.width-60&&y<g.height-60&&g.players.every(p=>p.hp<=0||Math.hypot(p.x-x,p.y-y)>=ENDLESS.spawnDistance)&&g.obstacles.every(o=>x<o.x-35||x>o.x+o.w+35||y<o.y-35||y>o.y+o.h+35)&&reserved.every(e=>e.hp<=0||Math.hypot(e.x-x,e.y-y)>48);}
export function advanceEndlessSpawns(g,dt,spawn){
 const alive=g.enemies.filter(e=>e.hp>0),warnings=g.spawnWarnings;
 for(let i=warnings.length-1;i>=0;i--){const w=warnings[i];w.left=Math.max(0,w.left-dt);if(w.left>0)continue;
  // Relocate a blocked warning with a fresh telegraph rather than telefragging.
  if(!safeSpawn(g,w.x,w.y,alive)){const random=stream(g.runSeed,g.combatRoom,`relocate-${w.kind}-${w.x}-${w.retries||0}`),reserved=[...alive,...warnings.filter(q=>q!==w)];for(let tries=0;tries<80;tries++){const x=65+random()*(g.width-130),y=65+random()*(g.height-130);if(safeSpawn(g,x,y,reserved)){Object.assign(w,{x,y,left:ENDLESS.spawnTell,retries:(w.retries||0)+1});break;}}continue;}
  const e=spawn(g,w.kind,w.x,w.y);if(w.elite&&!e.elite){e.elite=true;e.hp*=ENDLESS.eliteHealth;e.maxHp=e.hp;e.damageScale=ENDLESS.eliteDamage;}alive.push(e);warnings.splice(i,1);
 }
 g.spawnClock+=dt;
 if(g.spawnBudget>0&&(g.spawnSerial===0||alive.length<=2||g.spawnClock>=ENDLESS.reinforceTime)){
  const random=stream(g.runSeed,g.combatRoom,`spawn-${g.spawnSerial}`),reserved=[...alive,...warnings],counts={support:0,denial:0,frontline:0};for(const e of reserved){const r=roles(e.kind);counts.support+=Number(r.support);counts.denial+=Number(r.denial);counts.frontline+=Number(r.frontline);}
  let slots=g.difficulty.cap-reserved.length,added=0;
  while(slots>0&&g.spawnBudget>=2){let pool=unlockedEnemies(g.combatRoom).filter(k=>ENEMY_COSTS[k]<=g.spawnBudget&&(!roles(k).support||counts.support<ENDLESS.supports)&&(!roles(k).denial||counts.denial<ENDLESS.denial));const frontline=pool.filter(k=>roles(k).frontline);if(!counts.frontline&&frontline.length)pool=frontline;else if(reserved.length-counts.frontline>=Math.ceil(g.difficulty.cap*.65)&&frontline.length)pool=frontline;if(!pool.length)break;
   const kind=pool[Math.floor(random()*pool.length)];let pos;for(let tries=0;tries<80;tries++){const candidate={x:65+random()*(g.width-130),y:65+random()*(g.height-130)};if(safeSpawn(g,candidate.x,candidate.y,reserved)){pos=candidate;break;}}if(!pos)break;
   const elite=g.combatRoom>=ENDLESS.eliteStart&&random()<Math.min(ENDLESS.eliteMax,ENDLESS.eliteChance+(g.combatRoom-ENDLESS.eliteStart)*ENDLESS.elitePerRoom),warning={...pos,kind,left:ENDLESS.spawnTell,elite};warnings.push(warning);reserved.push(warning);const r=roles(kind);counts.support+=Number(r.support);counts.denial+=Number(r.denial);counts.frontline+=Number(r.frontline);g.spawnBudget-=ENEMY_COSTS[kind];slots--;added++;
  }if(added){g.spawnSerial++;g.spawnClock=0;}
 }
 if(g.spawnBudget<2)g.spawnBudget=0;g.remainingSpawnGroups=Number(g.spawnBudget>0)+warnings.length;
}
export function completeEndlessRoom(g){if(g.runStats.roomsCleared>=g.combatRoom)return;g.runStats.roomsCleared=g.combatRoom;for(const p of g.players){for(const c of p.curses||[])if(c.combatClearsLeft!=null)c.combatClearsLeft=Math.max(0,c.combatClearsLeft-1);p.curses=(p.curses||[]).filter(c=>c.combatClearsLeft==null||c.combatClearsLeft>0);}}
export function refreshEndlessStats(g){g.runStats.survivalTimeMs=Math.floor(g.time*1000);}
export function advanceDoorConsensus(g,dt){const living=g.players.filter(p=>p.hp>0&&!p.disconnected),door=g.routeDoors.find(d=>living.length&&living.every(p=>Math.hypot(p.x-d.x,p.y-d.y)<=ENDLESS.doorRadius)),members=living.map(p=>p.id).sort().join(',');if(!door){g.doorConsensus=null;return null;}if(g.doorConsensus?.choice!==door.choice||g.doorConsensus.members!==members)g.doorConsensus={choice:door.choice,members,left:ENDLESS.doorTime};else g.doorConsensus.left=Math.max(0,g.doorConsensus.left-dt);return g.doorConsensus.left===0?door.choice:null;}
export const ENDLESS_REWARDS=[{id:'endlessMight',name:'Tempered Edge',rarity:'common',desc:'+5% melee damage.',apply:p=>{p.damage+=.05;}},{id:'endlessVitality',name:'Enduring Roots',rarity:'common',desc:'+10 maximum HP and restore 10 HP.',apply:p=>{const gain=Math.max(1,Math.floor(10*(p.healthFactor??1)));p.maxHp+=gain;p.hp=Math.min(p.maxHp,p.hp+gain);}},{id:'endlessScrap',name:'Scrap Cache',rarity:'common',desc:'+20 spendable Scrap for your party.',apply:(_p,g)=>{g.scrap+=20;}}];
export function validEndlessUpgrade(u,p){const repeatable=['vitality','edge','speed','dash','distance','armor','parry','cleanse','vampire','perfection','stun','area','returnForce','dashSpark','punish','recovery'];if(u.kind||!repeatable.includes(u.id))return !p.upgrades.includes(u.id)&&(!u.requires||u.requires.every(id=>p.upgrades.includes(id)));const capped={armor:(p.armor||0)>=.5,area:(p.areaScale||1)>=1.8,parry:p.perfect>=.165,dash:p.dashIframes>=.3,stun:(p.stunBonus||0)>=2};return !capped[u.id]&&p.upgrades.filter(id=>id===u.id).length<5;}
