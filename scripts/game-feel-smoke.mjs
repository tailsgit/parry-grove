// Optional browser verification: npm install, then provide Playwright and a browser.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_EXECUTABLE=/path/to/chromium node scripts/game-feel-smoke.mjs
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.FEEL_OUTPUT||join(root,'docs/game-feel'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const template=await readFile(join(root,'tests/feel-preview.html'),'utf8'),code=template.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const bundle=await build({stdin:{contents:code,resolveDir:join(root,'tests'),loader:'jsx'},bundle:true,write:false,format:'esm',external:['/__before/*']});
const html=template.replace(/<script type="module">[\s\S]*<\/script>/,'<script type="module" src="/preview.js"></script>');
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/preview.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}
  else if(path==='/app/globals.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(join(root,'app/globals.css')));}
  else if(path.startsWith('/__before/game/')&&process.env.FEEL_BEFORE_DIR){
   const name=path.slice('/__before/game/'.length);if(!/^[a-z0-9-]+\.js$/.test(name))throw Error('Invalid fixture module');
   res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(process.env.FEEL_BEFORE_DIR,'game',name)));
  }else{res.setHeader('Content-Type','text/html');res.end(html);}
 }catch(error){res.statusCode=500;res.end(error.message);}
});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--autoplay-policy=no-user-gesture-required']});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const errors=[],results={};
try{
 await mkdir(output,{recursive:true});
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(30000);
 const url=`http://127.0.0.1:${server.address().port}`;
 for(const scene of ['perfect','melee','dash','scrap','internal','reward','explosion','boss']){
  console.log('Scene',scene);await page.goto(`${url}/?scene=${scene}`);await page.waitForFunction(()=>window.preview?.ready);
  if(scene==='scrap'){
   const before=await page.evaluate(()=>window.preview.stats());assert.ok(before.scrap>0);assert.ok(before.flights>0);
   await page.evaluate(()=>{for(let n=0;n<5;n++)window.preview.advance(.04);});
  }
  if(scene==='internal')await page.waitForTimeout(70);
  if(scene==='reward'){
   await page.getByRole('button').first().click();await page.waitForTimeout(90);
   assert.equal(await page.locator('.reward-confirmation').count(),1);
  }
  await page.screenshot({path:join(output,`${scene}-after.png`)});
  results[scene]=await page.evaluate(()=>window.preview.stats());
  if(scene==='scrap'){
   await page.evaluate(()=>{for(let n=0;n<15;n++)window.preview.advance(.04);});
   const collected=await page.evaluate(()=>window.preview.stats());assert.equal(collected.scrap,results.scrap.scrap);assert.ok(collected.arrivals>0);assert.equal(collected.flights,0);
  }
 }
 console.log('Actual client controls');await page.goto(`${url}/?app`);
 await page.evaluate(()=>localStorage.setItem('parry-grove-practice','skipped'));await page.getByRole('button',{name:'Play solo ↗'}).click();await page.locator('.game-hud').waitFor();
 await page.locator('canvas').focus();await page.keyboard.down('d');await page.waitForTimeout(440);await page.keyboard.up('d');
 if(!await page.getByRole('button',{name:'Pick up · E'}).isVisible()){await page.keyboard.down('d');await page.waitForTimeout(180);await page.keyboard.up('d');}
 await page.getByRole('button',{name:'Pick up · E'}).waitFor();await page.keyboard.press('e');
 await page.waitForFunction(()=>!document.querySelector('.draft-tooltip'));
 await page.keyboard.press('Space');await page.keyboard.press('q');await page.mouse.click(900,400);
 await page.waitForTimeout(900);await page.keyboard.press('Space');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Resume · Esc'}).waitFor();await page.getByRole('button',{name:'Resume · Esc'}).click();
 await page.screenshot({path:join(output,'app-solo-after.png')});results.actualClient={draftPickup:true,keyboardDashParry:true,meleeInput:true,pauseResume:true};
 console.log('Crowded scene');await page.goto(`${url}/?scene=crowded`);await page.waitForFunction(()=>window.preview?.ready);
 const crowded=await page.evaluate(()=>{const samples=[];for(let n=0;n<60;n++){const start=performance.now();window.preview.advance(1/60);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return {players:window.preview.stats().players,medianMs:samples[30],p95Ms:samples[57]};});results.crowded=crowded;
 console.log('Heavy scene');await page.goto(`${url}/?scene=heavy`);await page.waitForFunction(()=>window.preview?.ready);
 const heavy=await page.evaluate(()=>{
  const samples=[];for(let n=0;n<60;n++){const start=performance.now();window.preview.advance(1/60);samples.push(performance.now()-start);}
  return {...window.preview.stats(),samples};
 });
 heavy.samples.sort((a,b)=>a-b);results.heavy={...heavy,samples:undefined,medianMs:heavy.samples[30],p95Ms:heavy.samples[57]};
 assert.ok(heavy.particles<=240&&heavy.rings<=24&&heavy.ghosts<=32);assert.equal(heavy.players,4);
 console.log('Reduced motion');await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`${url}/?scene=dash`);await page.waitForFunction(()=>window.preview?.ready);
 const reduced=await page.evaluate(()=>window.preview.stats());assert.equal(reduced.reducedMotion,true);assert.equal(reduced.ghosts,0);results.reducedMotion=reduced;
 await page.setViewportSize({width:375,height:740});await page.goto(`${url}/?scene=perfect`);await page.waitForFunction(()=>window.preview?.ready);
 const boxes=await page.locator('.compact-hud,.room-hud').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
 assert.ok(boxes[0].right<=375&&boxes[0].left>=0);assert.ok(boxes[1].top>=boxes[0].bottom||boxes[1].left>=boxes[0].right);
 await page.screenshot({path:join(output,'mobile-reduced-after.png')});
 if(process.env.FEEL_BEFORE_DIR){
  await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:800});
  for(const scene of ['perfect','melee','dash']){await page.goto(`${url}/?scene=${scene}&before`);await page.waitForFunction(()=>window.preview?.ready);await page.screenshot({path:join(output,`${scene}-before.png`)});}
 }
 assert.deepEqual(errors,[]);results.pageErrors=errors;await writeFile(join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
