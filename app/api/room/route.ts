import { env } from 'cloudflare:workers';
import { roomState, member, advanceRoom, applyAction, publicRoom } from '@/game/rooms.js';

export async function POST(request: Request) {
  try {
    if(Number(request.headers.get('content-length'))>12000)return Response.json({error:'Request too large.'},{status:413});
    if(!env.DB)throw Error('Online rooms are temporarily unavailable. Solo play still works.');
    const db=env.DB.withSession('first-primary');
    const body=await request.json() as { action:string; name?:string; weapon?:string; code?:string; id?:string; token?:string; input?:Record<string,number|boolean>; upgrade?:string }; // Validated at the room boundary below.
    const now=Date.now();
    if(body.action==='create') {
      await db.prepare('DELETE FROM game_rooms WHERE updated_at < ?').bind(now-6*3600000).run();
      const m=member(body.name,body.weapon,now),r=roomState(m,now);
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for(let tries=0;tries<6;tries++) {
        const bytes=crypto.getRandomValues(new Uint8Array(6));const code=[...bytes].map(b=>alphabet[b%alphabet.length]).join('');
        const res=await db.prepare('INSERT OR IGNORE INTO game_rooms (code,state,revision,updated_at) VALUES (?,?,0,?)').bind(code,JSON.stringify(r),now).run();
        if(res.meta.changes)return Response.json({...publicRoom(code,r,0),session:{id:m.id,token:m.token}},{headers:{'Cache-Control':'no-store'}});
      }
      throw Error('Could not create a room. Please try again.');
    }
    const code=String(body.code||'').trim().toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))return Response.json({error:'Enter a valid six-character room code.'},{status:400});
    // Compare-and-swap prevents simultaneous polling / joining from overwriting each other.
    for(let retry=0;retry<10;retry++) {
      const row=await db.prepare('SELECT state,revision FROM game_rooms WHERE code = ?').bind(code).first<{state:string;revision:number}>();
      if(!row)return Response.json({error:'Room not found. Check the code.'},{status:404});
      const r=JSON.parse(row.state);
      let m=r.members.find((m:{id:string;token:string})=>m.id===body.id&&m.token===body.token);
      if(body.action!=='join'&&!m)return Response.json({error:'You have disconnected. Join a new lobby.'},{status:401});
      if(r.game&&['input','poll','leave'].includes(body.action)) {
        if(env.ROOMS){
          const realtimeResponse=await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://room.internal/state?code=${code}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:m?.id,token:m?.token,action:body.action,input:body.input})}));
          // Service binding responses have immutable headers. Return a fresh response
          // because the app router may add headers while finalizing the route.
          return new Response(realtimeResponse.body,{status:realtimeResponse.status,statusText:realtimeResponse.statusText,headers:new Headers(realtimeResponse.headers)});
        }
      }
      if(m)m.lastSeen=now;
      // Apply fresh controls before bounded catch-up to avoid another polling interval of input delay.
      if(m&&body.action==='input')applyAction(r,m,body,now);
      advanceRoom(r,now);
      if(body.action==='join') {
        if(r.game)return Response.json({error:'This room is already in a run. Wait for the lobby.'},{status:409});
        if(r.members.length>=4)return Response.json({error:'This room is full (4 players).'}, {status:409});
        m=member(body.name,body.weapon,now);m.slot=[0,1,2,3].find(s=>!r.members.some((p:{slot:number})=>p.slot===s))||0;r.members.push(m);if(!r.host)r.host=m.id;
      }else if(body.action!=='input')applyAction(r,m,body,now);
      const changed=await db.prepare('UPDATE game_rooms SET state = ?, revision = revision + 1, updated_at = ? WHERE code = ? AND revision = ?').bind(JSON.stringify(r),now,code,row.revision).run();
      if(changed.meta.changes)return Response.json({...publicRoom(code,r,row.revision+1),...(body.action==='join'?{session:{id:m.id,token:m.token}}:{})},{headers:{'Cache-Control':'no-store'}});
    }
    return Response.json({error:'Room busy. Retrying…'},{status:409});
  }catch(error) {
    console.error('room request:',error instanceof Error?error.message:error);
    return Response.json({error:error instanceof Error&&!/D1|SQLITE|database/i.test(error.message)?error.message:'Online rooms are temporarily unavailable. Try again or play solo.'},{status:400});
  }
}
