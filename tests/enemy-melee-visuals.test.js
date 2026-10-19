import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ENEMIES} from '../game/config.js';
import {enemyMeleePose,drawEnemyMeleeTrail,ENEMY_MELEE_VISUALS as V} from '../game/enemy-melee-visuals.js';
import {Renderer} from '../game/renderer.js';

for(const kind of ['brawler','lancer','riot']){
  const cfg=ENEMIES[kind],base={kind,action:'attack',angle:0,tellTotal:cfg.tell};
  test(`${kind}: anticipation is visible without trails; parry tells stay defensive`,()=>{
    const idle=enemyMeleePose({...base,tell:0,swing:0},cfg);
    const pulled=enemyMeleePose({...base,tell:.01},cfg);
    assert.equal(pulled.phase,'windup');assert.ok(pulled.angle<0);assert.equal(pulled.trail,false);
    if(kind==='brawler')assert.ok(pulled.tip>idle.tip);
    else assert.ok(pulled.tip<idle.tip);
    assert.equal(enemyMeleePose({...base,tell:.01,action:'parry'},cfg).phase,'idle');
  });
  test(`${kind}: immediate contact, bounded reach/width, short trail and recovery`,()=>{
    const contact=enemyMeleePose({...base,swing:.2},cfg);
    assert.equal(contact.tip,cfg.range);assert.equal(contact.angle,0);assert.ok(contact.trail);
    for(let elapsed=0;elapsed<.2;elapsed+=.001){
      const pose=enemyMeleePose({...base,swing:.2-elapsed},cfg);
      assert.ok(pose.tip<=cfg.range);assert.ok(Math.abs(pose.angle)<=cfg.arc/2);
      if(elapsed>=V.trailTime)assert.equal(pose.trail,false);
      const radii=[];
      const ctx=new Proxy({arc:(x,y,r,a,b)=>{radii.push(r);assert.ok(a>=-cfg.arc/2);assert.ok(b<=cfg.arc/2);}}, {get:(obj,key)=>obj[key]??(()=>{})});
      drawEnemyMeleeTrail(ctx,pose,cfg,false);
      assert.ok(radii.every(r=>r+V.trailWidth/2<=cfg.range));
    }
    const end=enemyMeleePose({...base,swing:.000001},cfg),idle=enemyMeleePose(base,cfg);
    assert.ok(Math.abs(end.tip-idle.tip)<.001);assert.ok(Math.abs(end.angle)<.001);
  });
}

test('follow-through keeps original aim when AI turns; cache is bounded and entity state stays unchanged',()=>{
  const c=new Proxy({}, {get:()=>()=>{}}),renderer=new Renderer({getContext:()=>c});
  const e={id:1,kind:'lancer',action:'attack',angle:.4,tell:.01,tellTotal:.48,swing:0};
  renderer.meleeWeapon(c,e,ENEMIES.lancer);
  e.tell=0;e.swing=.2;renderer.meleeWeapon(c,e,ENEMIES.lancer);
  e.angle=1.5;e.swing=.15;const before=structuredClone(e);renderer.meleeWeapon(c,e,ENEMIES.lancer);
  assert.equal(renderer.enemyStrikes.get(1).angle,.4);assert.deepEqual(e,before);
  for(let id=2;id<200;id++)renderer.meleeWeapon(c,{...e,id},ENEMIES.lancer);
  assert.equal(renderer.enemyStrikes.size,V.cacheLimit);
  renderer.meleeWeapon(c,{...e,id:199,swing:0},ENEMIES.lancer);assert.equal(renderer.enemyStrikes.has(199),false);
});
