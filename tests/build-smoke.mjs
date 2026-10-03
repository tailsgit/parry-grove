import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
process.env.CLOUDFLARE_CF_FETCH_ENABLED='false';
process.env.WRANGLER_SEND_METRICS='false';
const files=(await readdir('dist/server',{recursive:true})).filter(p=>/\.m?js$/.test(p)&&p!=='index.js');
const modules=['index.js',...files].map(p=>({type:'ESModule',path:'dist/server/'+p}));
const mf=new Miniflare({cf:false,modules,modulesRoot:'dist/server',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']});
try {
 const db=await mf.getD1Database('DB');await db.exec((await readFile('drizzle/0000_happy_kang.sql','utf8')).replaceAll('\n',' '));
 const response=await mf.dispatchFetch('http://game.test/');assert.equal(response.status,200);const html=await response.text();
 for(const text of ['PARRY GROVE','Play solo','Create co-op room','Choose your weapon','canvas'])assert.ok(html.toLowerCase().includes(text.toLowerCase()),`Missing ${text}`);
 const room=await mf.dispatchFetch('http://game.test/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',name:'Build smoke',weapon:'dagger'})});assert.equal(room.status,200);assert.equal((await room.json()).members[0].weapon,'dagger');
 console.log('Production Worker verified: rendered main menu and working D1 room endpoint.');
}finally{await mf.dispose();}
