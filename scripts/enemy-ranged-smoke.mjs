// Actual Canvas renderer, deterministic snapshots; no gameplay or network changes.
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=process.cwd(),output=resolve(process.env.RANGED_OUTPUT||'docs/enemy-ranged'),source=resolve(process.env.RANGED_SOURCE||root);
const bundle=await build({stdin:{resolveDir:root,contents:`
import {Renderer} from ${JSON.stringify(join(source,'game/renderer.js'))};
import {createGame,player,spawnEnemy} from './game/engine.js';
import {drawEnemyBeam} from './game/enemy-ranged-visuals.js';
const panels=[];
for(const [kind,label] of [['flamethrower','Torch Trooper'],['railgun','Rail Turret']])for(let phase=0;phase<3;phase++){
 const section=document.createElement('section');section.innerHTML='<h2>'+label+' · '+['windup','discharge','sustained'][phase]+'</h2><canvas width="560" height="310"></canvas>';document.querySelector('main').append(section);
 const r=new Renderer(section.querySelector('canvas')),g=createGame([player('p','Tester')],31);g.width=560;g.height=290;g.enemies=[];g.obstacles=[];g.events=[];g.intro=0;g.phase='combat';g.players[0].x=480;g.players[0].y=230;g.time=10;
 const e=spawnEnemy(g,kind,100,140);e.angle=0;e.tellTotal=kind==='railgun'?.35:.45;e.action='attack';e.danger=kind==='railgun';
 if(!phase){e.tell=e.tellTotal*.2;if(kind==='flamethrower')e.l3Tell='flame';}
 else{const fire=kind==='flamethrower';e.tell=0;e.recoil=phase===1?.2:0;e.flameLeft=fire?.6:0;g.hazards=[{id:99,kind:'beam',x:fire?124:100,y:140,ex:fire?290:520,ey:140,r:fire?18:9,remaining:phase===1?(fire?.7:.98):.24,total:fire?.72:1,shortBeam:fire}];}
 panels.push({r,g});
}
const section=document.createElement('section');section.innerHTML='<h2>Reactor Wyrm minions</h2><canvas width="560" height="200"></canvas>';document.querySelector('main').append(section);
const r=new Renderer(section.querySelector('canvas')),c=r.ctx;
function minions(){c.fillStyle='#173f38';c.fillRect(0,0,560,200);for(let i=0;i<3;i++)r.enemy(c,{id:40+i,kind:'radMinion',x:130+i*140,y:100,angle:i*.8,hp:1,maxHp:1});}
function paint(t=0,reduced=false){for(const {r,g} of panels){r.reducedMotion=reduced;r.feedback.clock=t;r.draw(g,'p',0);}minions();}
function check(){
 const canvas=document.createElement('canvas');canvas.width=400;canvas.height=160;const ctx=canvas.getContext('2d');let checked=0;const signatures=new Map();
 for(const fire of [false,true])for(const reduced of [false,true])for(const t of [0,.07,.3,.6]){
  ctx.clearRect(0,0,400,160);const h={kind:'beam',x:60,y:80,ex:340,ey:80,r:fire?18:9,remaining:.5,total:1,shortBeam:fire};const saved=JSON.stringify(h);drawEnemyBeam(ctx,h,t,reduced);if(JSON.stringify(h)!==saved)throw Error('Renderer mutated hazard');const data=ctx.getImageData(0,0,400,160).data;let hash=0;for(const value of data)hash=(Math.imul(hash,31)+value)|0;const key=fire+':'+reduced;if(!signatures.has(key))signatures.set(key,new Set());signatures.get(key).add(hash);
  for(let y=0;y<160;y++)for(let x=0;x<400;x++)if(data[(y*400+x)*4+3]&&(x<60||x>=340||y<80-h.r||y>=80+h.r))throw Error('Beam art escaped damage bounds');checked++;
 }
 for(const fire of [false,true]){if(signatures.get(fire+':false').size<2)throw Error('Beam animation is static');if(signatures.get(fire+':true').size!==1)throw Error('Reduced motion still animates');}return {boundedBeamFrames:checked,immutableSnapshots:true,animatedBeams:true,reducedMotionStable:true};
}
window.qa={paint,check};paint(.04);
`},bundle:true,write:false,format:'esm'});
const html='<html><head><meta charset="utf-8"><style>body{margin:20px;background:#102d28;color:#f5e4bc;font:14px monospace}h1{font-size:22px}h2{font-size:14px}main{display:grid;grid-template-columns:repeat(3,560px);gap:12px}canvas{display:block;width:560px;height:310px}section:last-child canvas{height:200px}</style></head><body><h1>Enemy attack readability · real renderer snapshots</h1><main></main><script type="module" src="/scene.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/scene.js'?'text/javascript':'text/html');res.end(req.url==='/scene.js'?bundle.outputFiles[0].contents:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});const page=await browser.newPage({viewport:{width:1744,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.qa);
 await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'attack-phases.png')});const result=await page.evaluate(()=>window.qa.check());
 await page.evaluate(()=>window.qa.paint(.3,true));await page.screenshot({path:join(output,'reduced-motion.png')});
 assert.deepEqual(errors,[]);await writeFile(join(output,'results.json'),JSON.stringify({...result,pageErrors:errors},null,2));console.log(result);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
