// Canvas-only fixture: draws the real Renderer at deterministic animation samples.
// PLAYWRIGHT_MODULE=/path/to/index.mjs BROWSER_EXECUTABLE=/path/to/chromium node scripts/enemy-melee-smoke.mjs
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.MELEE_OUTPUT||join(root,'docs/enemy-melee'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const bundle=await build({stdin:{resolveDir:root,contents:`
import {Renderer} from ${JSON.stringify(join(process.env.MELEE_BEFORE_DIR||root,'game/renderer.js'))};
import {ENEMIES} from './game/config.js';
import {enemyMeleePose} from './game/enemy-melee-visuals.js';
const canvas=document.querySelector('canvas'),c=canvas.getContext('2d'),r=new Renderer(canvas);
const kinds=['brawler','lancer','riot'],samples=[['Ready',0,0],['Pullback',.5,0],['Anticipation',.04,0],['Contact',0,.2],['Follow-through',0,.15],['Recovery',0,.055]];
function enemy(kind,col,row,tell,swing){const cfg=ENEMIES[kind];return {id:row*10+col,kind,x:col*210+62,y:row*190+145,angle:0,hp:cfg.hp,maxHp:cfg.hp,tell:tell*cfg.tell,tellTotal:cfg.tell,action:'attack',swing};}
function paint(){
 c.fillStyle='#183c30';c.fillRect(0,0,1260,660);c.fillStyle='#f4e4c0';c.font='20px Georgia';c.fillText('Melee weapon animation — existing combat timing',24,32);
 samples.forEach(([label],i)=>{c.font='14px monospace';c.fillText(label,i*210+24,65);});
 kinds.forEach((kind,row)=>{c.fillStyle=ENEMIES[kind].color;c.font='bold 15px monospace';c.fillText(ENEMIES[kind].name,24,row*190+98);samples.forEach(([,tell,swing],col)=>r.enemy(c,enemy(kind,col,row,tell,swing)));});
}
window.qa={paint,reduced(value){r.reducedMotion=value;paint();},stress(){const times=[];for(let frame=0;frame<120;frame++){const start=performance.now();for(let n=0;n<48;n++){const kind=kinds[n%3],e=enemy(kind,n%6,Math.floor(n/6),0,.2-(frame%12)/60);e.id=n+100;r.enemy(c,e);}times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {medianMs:times[60],p95Ms:times[114],cache:r.enemyStrikes?.size||0};},poses:kinds.map(kind=>({kind,contact:enemyMeleePose({kind,swing:.2,action:'attack'},ENEMIES[kind])})),animate(t){c.fillStyle='#183c30';c.fillRect(0,0,1260,660);kinds.forEach((kind,row)=>{const cfg=ENEMIES[kind],cycle=(t/1000)%(cfg.tell+.7);const e=enemy(kind,2,row,cycle<cfg.tell?1-cycle/cfg.tell:0,cycle>=cfg.tell?Math.max(0,.2-(cycle-cfg.tell)):0);r.enemy(c,e);});}};paint();
`},bundle:true,write:false,format:'esm'});
const html='<html><body style="margin:0;background:#183c30"><canvas width="1260" height="660"></canvas><script type="module" src="/preview.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'text/javascript':'text/html');res.end(req.url==='/preview.js'?bundle.outputFiles[0].contents:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
try{
 await mkdir(output,{recursive:true});const page=await browser.newPage({viewport:{width:1260,height:660}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.qa);
 await page.screenshot({path:join(output,'weapon-phases.png')});
 const results=await page.evaluate(()=>({poses:window.qa.poses,stress:window.qa.stress()}));
 await page.evaluate(()=>window.qa.reduced(true));await page.screenshot({path:join(output,'reduced-motion.png')});
 // Capture deterministic frames for optional ffmpeg animation export.
 if(process.env.MELEE_FRAMES){await mkdir(join(output,'frames'),{recursive:true});for(let i=0;i<60;i++){await page.evaluate(t=>window.qa.animate(t),i*1000/60);await page.screenshot({path:join(output,'frames',String(i).padStart(3,'0')+'.png')});}}
 assert.deepEqual(errors,[]);assert.ok(results.stress.cache<=128);await writeFile(join(output,'results.json'),JSON.stringify({...results,pageErrors:errors},null,2));console.log(results);
}finally{await browser.close();await new Promise(r=>server.close(r));}
