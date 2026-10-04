export function stressGame(engine,count){
  const g=engine.createGame([engine.player('p','P','longsword')],73);g.intro=0;g.obstacles=[];g.enemies.length=0;g.players[0].hp=1e9;g.players[0].maxHp=1e9;
  for(let i=0;i<count;i++)engine.spawnEnemy(g,i%3===0?'homing':'brawler',80+i%20*40,80+Math.floor(i/20)*40);
  return g;
}
export function stressInput(tick,input){input.mx=.4;input.my=.3;input.angle=.5;input.attack=true;input.guard=true;input.parry=Math.floor(tick/30);input.dash=0;}
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){const result={};for(const key of Object.keys(value).sort())if(!['scenerySeed','sceneryStage','stage'].includes(key)&&value[key]!==undefined)result[key]=canonical(value[key]);return result;}
  return value;
}
