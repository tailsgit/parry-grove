import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beamEndpoint} from '../game/beam-geometry.js';
import {createGame,player,spawnEnemy,step} from '../game/engine.js';

test('rail warnings and fired beams stop at the same cover-padded endpoint',()=>{
  for(const angle of [0,.4,Math.PI/2,Math.PI,-.7]){
    const p=player('p','Tester'),g=createGame([p],31);g.enemies=[];g.obstacles=[{x:420,y:120,w:50,h:260}];g.intro=0;
    p.x=100;p.y=430;p.invuln=10;
    const e=spawnEnemy(g,'railgun',280,260);e.angle=angle;e.tell=.001;e.tellTotal=.35;e.action='attack';e.danger=true;e.cooldown=100;e.nearPlayer=true;
    const before=beamEndpoint(g,e,angle);
    step(g,{},1/60);
    const h=g.hazards.find(h=>h.kind==='beam');assert.ok(h);
    assert.equal(h.ex,before.x);assert.equal(h.ey,before.y);
    assert.equal(h.r,9);assert.equal(h.total,1);
  }
});

test('beam geometry preserves the original four-pixel march across arena edges and cover',()=>{
  const g={width:900,height:570,obstacles:[{x:380,y:130,w:50,h:200},{x:100,y:400,w:500,h:25}]},e={x:300,y:270};
  const original=(angle)=>{
    const end={x:e.x,y:e.y};
    for(let n=24;n<Math.hypot(g.width,g.height);n+=4){
      const x=e.x+Math.cos(angle)*n,y=e.y+Math.sin(angle)*n;
      if(x<25||x>g.width-25||y<25||y>g.height-25||g.obstacles.some(o=>x>o.x-9&&x<o.x+o.w+9&&y>o.y-9&&y<o.y+o.h+9))break;
      end.x=x;end.y=y;
    }
    return end;
  };
  for(let i=0;i<360;i++)assert.deepEqual(beamEndpoint(g,e,i*Math.PI/180),original(i*Math.PI/180));
});
