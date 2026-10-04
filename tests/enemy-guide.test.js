import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_GUIDE,filterEnemies} from '../game/enemy-guide.js';
import {ENEMIES,LEVELS} from '../game/config.js';
test('encyclopedia covers every campaign enemy and boss with artwork metadata and both explanations',()=>{
  const roster=LEVELS.flatMap(l=>[...l.enemies,...l.bosses]);
  assert.equal(ENEMY_GUIDE.length,19);
  assert.deepEqual(ENEMY_GUIDE.map(e=>e.id),roster);
  assert.equal(new Set(roster).size,19);
  for(const e of ENEMY_GUIDE){assert.equal(e.name,ENEMIES[e.id].name);assert.ok(e.role&&e.mechanic&&e.counter);}
  assert.equal(ENEMY_GUIDE.filter(e=>e.boss).length,3);
});
test('players can find enemies by case-insensitive name, mechanic and campaign level',()=>{
  assert.equal(filterEnemies('',1).length,9);assert.equal(filterEnemies('',2).length,10);
  assert.deepEqual(filterEnemies('  SUICIDE  ').map(e=>e.id),['suicide']);
  assert.ok(filterEnemies('five seconds').some(e=>e.id==='magnet'));
  assert.equal(filterEnemies('Suicide',1).length,0);
  assert.equal(filterEnemies('nonexistent enemy').length,0);
});
test('guide explains the special defense exceptions and current mine/escort rules',()=>{
  const byId=Object.fromEntries(ENEMY_GUIDE.map(e=>[e.id,e]));
  assert.match(byId.suicide.mechanic,/immune/i);assert.match(byId.suicide.counter,/blocking and parrying do not/);
  assert.match(byId.magnet.mechanic,/Blocking does not stop/);
  assert.match(byId.miner.mechanic,/timer runs during retreat/);assert.match(byId.miner.mechanic,/unlimited mines/);
  assert.match(byId.riot.mechanic,/prioritizing ranged/);
  assert.match(byId.boss.mechanic,/20 damage/);
});
