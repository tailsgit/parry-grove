import {UPGRADES,ENEMIES,WEAPONS,BALANCE as B} from './config.js';
import {createGame,clearArena,generateRoom,random,stepPlayer,distance,event} from './engine.js';
export const KITS=[
 {id:'fractured',name:'Fractured Vanguard',weapon:'longsword',upgrades:['edge'],shield:45,desc:'Keen Edge · starts with 55 shield'},
 {id:'precise',name:'Perfect Initiate',weapon:'dagger',upgrades:['perfection'],desc:'Perfection · recover shield with perfect parries'},
 {id:'wide',name:'Wide Sentinel',weapon:'longsword',upgrades:['area'],desc:'Wide Wake · wider swings and effects'},
 {id:'stunner',name:'Patient Duelist',weapon:'sword',upgrades:['stun'],desc:'Lingering Steel · longer melee parry stuns'},
 {id:'runner',name:'Fleet Scout',weapon:'dagger',upgrades:['speed'],health:85,desc:'Windrunner · starts with 85 maximum HP'},
 {id:'bark',name:'Ironbark Guard',weapon:'sword',upgrades:['armor'],desc:'Barkskin · 10% damage reduction'},
 {id:'hungry',name:'Hungry Knight',weapon:'longsword',upgrades:['vampire'],health:80,desc:'Vampire · starts with 80 maximum HP'},
 {id:'spark',name:'Spark Runner',weapon:'dagger',upgrades:['dashSpark'],desc:'Spark Step · damaging dash pulses'},
];
export const relics=()=>UPGRADES.filter(u=>u.kind==='relic');
export function grantUpgrade(p,id){const u=UPGRADES.find(u=>u.id===id);if(!u)throw Error('Unknown upgrade.');if(u.kind&&p.upgrades.includes(id))throw Error('You already own this relic or synergy.');u.apply(p);p.upgrades.push(id);}
function sample(g,pool,n){const available=[...pool],out=[];while(out.length<n&&available.length){const i=Math.floor(random(g)*available.length);out.push(available.splice(i,1)[0]);}return out;}
export function upgradeOffers(g,p){
 const eligible=UPGRADES.filter(u=>u.kind==='synergy'&&!p.upgrades.includes(u.id)&&u.requires.every(id=>p.upgrades.includes(id)));
 const basic=UPGRADES.filter(u=>!u.kind);const offers=[];
 // A qualified combination gets a 65% featured slot; it is never guaranteed.
 if(eligible.length&&random(g)<.65)offers.push(sample(g,eligible,1)[0].id);
 offers.push(...sample(g,basic,3-offers.length).map(u=>u.id));return offers;
}
export function createRun(players,seed){const g=createGame(players,seed);g.runSystems=true;g.hostId=players[0]?.id;g.scrap=0;g.phase='draft';clearArena(g);g.intro=0;
 g.kits=sample(g,KITS,players.length===1?3:players.length+2).map((kit,i)=>({id:kit.id,x:280+(i%3)*170,y:players.length===1?285:220+Math.floor(i/3)*180,claimedBy:null}));
 for(const p of players){p.x=230;p.kitId=null;p.healthFactor=1;}return g;}
export function claimKit(g,id,kitId){const p=g.players.find(p=>p.id===id),pick=g.kits?.find(k=>k.id===kitId),kit=KITS.find(k=>k.id===kitId);
 if(g.phase!=='draft'||!p||p.kitId||!pick||pick.claimedBy||distance(p,pick)>80)throw Error('Move next to an available kit and press E.');
 pick.claimedBy=id;p.kitId=kitId;p.weapon=kit.weapon;p.maxHp=kit.health||p.maxHp;p.hp=p.maxHp;p.shieldDamage=kit.shield||0;for(const u of kit.upgrades)grantUpgrade(p,u);
 event(g,'upgrade',p.x,p.y,kit.name,p.id);finishDraft(g);
}
function finishDraft(g){if(g.players.length&&g.players.every(p=>p.kitId)){g.kits=[];g.phase='combat';generateRoom(g);}}
export function openRouteDoors(g){
 g.routeDoors=g.routeOptions.map(choice=>({choice,x:choice==='continue'?32:choice==='altar'?g.width-32:g.width/2,y:choice==='shop'?g.height-32:g.height*.64,side:choice==='continue'?'left':choice==='altar'?'right':'bottom'}));
 // Keep the cleared room intact, but guarantee a cover-free corridor to every exit.
 g.obstacles=g.obstacles.filter(o=>!g.routeDoors.some(d=>d.side==='bottom'?o.x<d.x+55&&o.x+o.w>d.x-55&&o.y+o.h>g.height-135:o.y<d.y+55&&o.y+o.h>d.y-55&&(d.side==='left'?o.x<135:o.x+o.w>g.width-135)));
}
export function beginRoute(g){g.phase='route';g.pendingRoom=g.room+1;g.routeOptions=g.pendingRoom===B.encounters?['shop']:['continue','altar'];
 if(g.pendingRoom!==B.encounters&&random(g)<.35)g.routeOptions.push('shop');
 clearArena(g,true);g.intro=0;openRouteDoors(g);
 // Physical routing needs living party members, including a host downed in combat.
 const survivor=g.players.find(p=>p.hp>0);for(const p of g.players)if(p.hp<=0){p.hp=p.maxHp*.5;p.routeRevived=true;if(survivor){p.x=survivor.x;p.y=survivor.y;}}
}
function enterCombat(g){g.room=g.pendingRoom;g.pendingRoom=undefined;g.phase='combat';g.stock=[];g.altarOffers=[];g.routeDoors=[];for(const p of g.players){p.vendorOpen=false;p.altarOpen=false;p.hp=p.hp<=0?p.maxHp*.5:Math.min(p.maxHp,p.hp+(p.routeRevived?0:8));p.routeRevived=false;p.internal=0;}generateRoom(g);}
export function selectRoute(g,id,choice){if(g.phase!=='route'||id!==g.hostId||!g.routeOptions.includes(choice))throw Error('Only the host can choose an available route.');
 const p=g.players.find(p=>p.id===id),door=g.routeDoors?.find(d=>d.choice===choice);if(!p||p.hp<=0||!door||distance(p,door)>32)throw Error('Walk through the chosen exit.');
 if(choice==='continue'){enterCombat(g);return;}g.routeDoors=[];g.phase=choice;clearArena(g);g.intro=0;g.stopSerial=(g.stopSerial||0)+1;g.station={x:g.width/2,y:g.height/2};g.exit={x:g.width-100,y:g.height/2};
 for(const [i,p] of g.players.entries()){p.x=130;p.y=g.height/2+(i-(g.players.length-1)/2)*40;p.vendorOpen=false;p.altarOpen=false;}
 if(choice==='shop')g.stock=[{id:'repair',name:'Full shield repair',desc:'Restore your shield to 100.',cost:45,left:2},{id:'heal',name:'Health tonic',desc:'Heal 35% of your maximum HP.',cost:25,left:2},...sample(g,UPGRADES.filter(u=>!u.kind),2).map(u=>({id:u.id,name:u.name,desc:u.desc,cost:35,left:1})),...sample(g,relics(),2).map(u=>({id:u.id,name:u.name,desc:u.desc,cost:90,left:1}))];
 else g.altarOffers=sample(g,relics(),3).map(u=>u.id);
}
export function buyItem(g,id,itemId){const p=g.players.find(p=>p.id===id),item=g.stock?.find(s=>s.id===itemId);
 if(g.phase!=='shop'||!p||p.hp<=0||!p.vendorOpen||distance(p,g.station)>90||!item||item.left<1)throw Error('Interact with the vending machine to buy available stock.');
 if(g.scrap<item.cost)throw Error('The party needs more Scrap.');
 if(itemId==='repair'){if(!p.shieldDamage)throw Error('Your shield is already full.');p.shieldDamage=0;p.shieldBroken=false;}
 else if(itemId==='heal'){if(p.hp>=p.maxHp)throw Error('Your health is already full.');p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.35);}
 else grantUpgrade(p,itemId);
 g.scrap-=item.cost;item.left--;event(g,'upgrade',p.x,p.y,item.name,p.id);
}
export function sacrifice(g,id,relic){const p=g.players.find(p=>p.id===id);
 if(g.phase!=='altar'||!p||p.hp<=0||!p.altarOpen||distance(p,g.station)>90||p.altarUsed===g.stopSerial||!g.altarOffers.includes(relic)||p.maxHp<20)throw Error('This sacrifice is unavailable.');
 if(p.upgrades.includes(relic))throw Error('You already own this relic.');
 const loss=Math.ceil(p.maxHp*.25);p.healthFactor=(p.healthFactor??1)*.75;p.maxHp-=loss;p.hp=Math.min(p.hp,p.maxHp);p.altarUsed=g.stopSerial;grantUpgrade(p,relic);event(g,'upgrade',p.x,p.y,'SACRIFICE ACCEPTED',p.id);
}
export function stepPeaceful(g,inputs,dt){
 if(!['draft','shop','altar','route'].includes(g.phase))return false;
 if(g.phase==='route'&&!g.routeDoors?.length)openRouteDoors(g);
 if(g.phase==='draft'){finishDraft(g);if(g.phase!=='draft')return true;}
 for(const p of g.players){const i=inputs[p.id]||{};if(p.hp<=0)continue;
  stepPlayer(g,p,i,dt,p.vendorOpen||p.altarOpen);
  if(g.phase==='route'){
   p.seenInteract=Math.max(p.seenInteract,i.interact||0);
   if(p.id===g.hostId){const mx=(i.mx||0)||p.vx||(p.dashLeft>0?p.dx:0),my=(i.my||0)||p.vy||(p.dashLeft>0?p.dy:0);const door=g.routeDoors.find(d=>distance(p,d)<=32&&(d.side==='left'?mx<0:d.side==='right'?mx>0:my>0));if(door){selectRoute(g,p.id,door.choice);return true;}}
   continue;
  }
  if((i.interact||0)>p.seenInteract){p.seenInteract=i.interact;
   if(g.phase==='draft'&&!p.kitId){const kit=g.kits.find(k=>!k.claimedBy&&distance(p,k)<=80);if(kit)claimKit(g,p.id,kit.id);}
   else if(g.phase!=='draft'&&g.station&&distance(p,g.station)<=90){if(g.phase==='shop')p.vendorOpen=true;else p.altarOpen=true;}
   else if(g.phase!=='draft'&&p.id===g.hostId&&g.exit&&distance(p,g.exit)<=80){enterCombat(g);return true;}
  }
 }return true;
}
export function scrapFor(e){return ENEMIES[e.kind].boss?70:8;}
export function kitLabel(id){const k=KITS.find(k=>k.id===id);return k?`${k.name} · ${WEAPONS[k.weapon].name}`:'';}
