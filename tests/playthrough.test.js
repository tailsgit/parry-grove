import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS} from '../game/config.js';
import {createGame,player,step,chooseUpgrade,distance} from '../game/engine.js';
for(const weapon of ['dagger','sword','longsword'])test(`normal-health full playthrough: ${weapon}`,()=>{
 const p=player('bot','Bot',weapon),g=createGame([p],42);let seq=0,dash=0,interact=0,endedAt;
 for(let n=0;n<60000;n++){
  if(g.phase==='death'||g.phase==='victory'){endedAt=n/60;break;}
  if(g.phase==='upgrade'){chooseUpgrade(g,p.id,p.offers.find(id=>id==='vitality')||p.offers.find(id=>id==='edge')||p.offers[0]);step(g,{bot:{interact:++interact}},1/60);continue;}
  const enemy=g.enemies.reduce((a,b)=>!a||distance(p,b)<distance(p,a)?b:a,null);if(!enemy)continue;
  const target={x:enemy.x,y:enemy.y};let angle=Math.atan2(target.y-p.y,target.x-p.x);
  // Grid BFS finds paths around randomized cover, using the same collision radius as play.
  const cell=30,w=Math.ceil(g.width/cell),h=Math.ceil(g.height/cell),start=[Math.floor(p.x/cell),Math.floor(p.y/cell)],end=[Math.floor(target.x/cell),Math.floor(target.y/cell)];
  const key=(x,y)=>y*w+x;const queue=[start],parent=new Map([[key(...start),null]]);let goal=null;
  for(let qi=0;qi<queue.length;qi++){const [x,y]=queue[qi];if(Math.hypot(x-end[0],y-end[1])<1.5){goal=[x,y];break;}for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,wx=nx*cell+cell/2,wy=ny*cell+cell/2,k=key(nx,ny);if(nx<1||ny<1||nx>=w-1||ny>=h-1||parent.has(k)||g.obstacles.some(o=>wx>o.x-17&&wx<o.x+o.w+17&&wy>o.y-17&&wy<o.y+o.h+17))continue;parent.set(k,[x,y]);queue.push([nx,ny]);}}
  if(goal){while(parent.get(key(...goal))&&key(...parent.get(key(...goal)))!==key(...start))goal=parent.get(key(...goal));target.x=goal[0]*cell+cell/2;target.y=goal[1]*cell+cell/2;}
  let mx=target.x-p.x,my=target.y-p.y;if(distance(p,enemy)<WEAPONS[weapon].range*.7){mx=0;my=0;}
  for(const bullet of g.bullets.filter(b=>!b.owner)){
   const vx=p.x-bullet.x,vy=p.y-bullet.y,s2=bullet.vx**2+bullet.vy**2,t=(vx*bullet.vx+vy*bullet.vy)/s2;
   const miss=Math.hypot(vx-bullet.vx*t,vy-bullet.vy*t);
   if(t>0&&t<.10&&miss<20&&!p.parryCd){seq++;angle=Math.atan2(-bullet.vy,-bullet.vx);break;}
  }
  const hazard=g.hazards.find(h=>distance(p,h)<h.r+30&&h.remaining<.5);if(hazard){mx=p.x-hazard.x||1;my=p.y-hazard.y||1;if(!p.dashCd)dash++;}
  step(g,{bot:{mx,my,angle,attack:true,parry:seq,dash,interact}},1/60);
 }
 assert.equal(g.phase,'victory');assert.equal(g.room,4);assert.ok(p.hp>0);assert.ok(p.perfects>0);assert.equal(p.kills,19);assert.ok(endedAt<120);
});
