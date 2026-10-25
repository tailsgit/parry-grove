import { env } from 'cloudflare:workers';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return Response.json({ error: 'Enter a valid six-character room code.' }, { status: 400 });
  if (!env.ROOMS) return Response.json({ error: 'Realtime rooms are not configured.' }, { status: 503 });
  if(env.ROOM_SOCKET_ADMISSION&&!(await env.ROOM_SOCKET_ADMISSION.limit({key:'socket:'+request.headers.get('CF-Connecting-IP')})).success)return Response.json({error:'Too many reconnect attempts. Wait a moment.'},{status:429});
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
}
