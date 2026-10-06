import {test} from 'node:test';
import assert from 'node:assert/strict';
import {player,createGame,step,chooseUpgrade} from '../game/engine.js';
import {rewardShortcut} from '../game/reward-input.js';
const setup=()=>{const g=createGame([player('p','Tester')],42);g.enemies=[];step(g,{},1/60);g.players[0].offers=['dashSpark','recovery','cleanse'];return g;};
test('number shortcuts select the corresponding real offered upgrade exactly once',()=>{for(const key of ['1','2','3']){const g=setup(),p=g.players[0],id=p.offers[Number(key)-1];assert.equal(rewardShortcut(g,'p',key),id);assert.equal(chooseUpgrade(g,'p',rewardShortcut(g,'p',key)),true);assert.ok(p.upgrades.includes(id));assert.equal(rewardShortcut(g,'p',key),null);}});
test('shortcut ignores held keys, other phases, spectators, missing offers and non-choice keys',()=>{const g=setup();assert.equal(rewardShortcut(g,'p','1',true),null);for(const key of ['0','4','q','Escape'])assert.equal(rewardShortcut(g,'p',key),null);assert.equal(rewardShortcut(g,'unknown','1'),null);g.players[0].hp=0;assert.equal(rewardShortcut(g,'p','1'),null);g.players[0].hp=100;g.players[0].offers=[];assert.equal(rewardShortcut(g,'p','1'),null);g.players[0].offers=['dashSpark'];for(const phase of ['draft','combat','shop','altar','route','death']){g.phase=phase;assert.equal(rewardShortcut(g,'p','1'),null);}});
