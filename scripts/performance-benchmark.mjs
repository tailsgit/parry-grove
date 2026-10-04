import * as optimized from '../game/engine.js';
import {stressGame} from '../tests/performance-scenario.js';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const baseline=process.argv[2]?await import(pathToFileURL(resolve(process.argv[2])).href):null;
for(const enemies of [12,180,400]){
  const result={enemies};
  for(const [label,engine] of baseline?[['baseline',baseline],['optimized',optimized]]:[['optimized',optimized]]){
    const samples=[];
    for(let run=0;run<7;run++){
      const g=stressGame(engine,enemies),inputs={p:{mx:0,my:0,attack:false,guard:true}};
      for(let tick=0;tick<100;tick++)engine.step(g,inputs,1/60);
      const start=performance.now();for(let tick=0;tick<1200;tick++)engine.step(g,inputs,1/60);
      samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);result[label+'Ms']=samples[3];
  }
  if(baseline)result.speedup=result.baselineMs/result.optimizedMs;
  console.log(JSON.stringify(result));
}
