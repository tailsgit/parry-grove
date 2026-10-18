// Presentation only. Seconds and world pixels; never read by combat simulation.
export const FEEL=Object.freeze({
  particles:240,labels:28,rings:24,contacts:24,reactions:40,afterimages:32,reflections:32,flights:8,
  voices:12,soundGap:.035,pickupGap:.12,pickupReset:.55,pickupPitchCap:5,
  missGap:.8,eventAge:.7,shake:7,impulseTime:.12,contactTime:.1,recoilTime:.14,
  ghostGap:.035,ghostLife:.18,flightTime:.55,flightGroup:.075,
  teammateScale:.45,distantScale:.22,distantRange:480,
  perfect:Object.freeze({color:'#b8ffaf',count:18,radius:43,duration:.23,shake:4.5}),
  regular:Object.freeze({color:'#ffbc65',count:7,radius:26,duration:.18,shake:1.6}),
  melee:Object.freeze({color:'#fff1bd',count:7,radius:16,duration:.14,shake:1.8}),
  swingTime:.15,streakCap:6,
});
export const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

// A short anticipation is visual only: engine damage still lands immediately.
export function swingPose(player){
  const w=player.weapon,elapsed=clamp(1-player.swing/FEEL.swingTime,0,1);
  // Connected hits must already look like contact during solo hit pause.
  const progress=player.connected?.22+elapsed*.78:elapsed;
  const arc=player.arc??0;
  let sweep;
  if(progress<.12)sweep=-.5-progress*.65;
  else if(progress<.57)sweep=-.578+1.13*(1-(1-(progress-.12)/.45)**3);
  else sweep=progress===1?0:.552*(1-(progress-.57)/.43);
  return {progress,offset:arc*(progress<.12?sweep:clamp(sweep,-.5,.5)),trail:progress>=.12&&progress<.7,tip:w==='dagger'?34:w==='sword'?52:65};
}

export function effectScale(event,listener){
  if(!listener||event.who===listener.id)return 1;
  return Math.hypot(event.x-listener.x,event.y-listener.y)>FEEL.distantRange?FEEL.distantScale:FEEL.teammateScale;
}

export function impactProfile(event){
  if(event.kind==='perfect')return FEEL.perfect;
  if(event.kind==='regular')return FEEL.regular;
  if(event.kind==='hit'&&event.weaponAction==='melee')return FEEL.melee;
  return null;
}
