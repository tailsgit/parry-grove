const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export const RANGED_VISUALS=Object.freeze({flameTongues:11,flameRate:5,railBands:14,railRate:2.5});

// Stateless, bounded Canvas artwork. Uses snapshot geometry and a cosmetic clock;
// never spawns gameplay entities or consumes the simulation's random stream.
export function drawEnemyBeam(c,h,time,reduced=false){
  if(h.kind!=='beam'||h.owner)return false;
  const length=Math.hypot(h.ex-h.x,h.ey-h.y);
  if(!Number.isFinite(length)||length<=0||h.remaining<=0)return true;
  const fire=!!h.shortBeam,r=h.r,age=Math.max(0,h.total-h.remaining);
  c.save();c.translate(h.x,h.y);c.rotate(Math.atan2(h.ey-h.y,h.ex-h.x));
  // Hard bounds communicate the full live hitbox until it expires. Details are
  // clipped: neither the luminous core nor the moving tongues extend its reach.
  c.beginPath();c.rect(0,-r,length,r*2);c.clip();
  if(fire){
    const phase=reduced?.4:(time*RANGED_VISUALS.flameRate)%1;
    c.fillStyle='#ff71372b';c.fillRect(0,-r,length,r*2);
    c.fillStyle='#ffb65a88';c.fillRect(0,-r,length,1);c.fillRect(0,r-1,length,1);
    c.fillStyle='#f7642c';c.beginPath();c.moveTo(0,-3);
    for(let i=1;i<=12;i++)c.lineTo(i/12*length,-r*(.65+.3*Math.sin(i*2.3+phase*6)));
    c.lineTo(length,0);
    for(let i=12;i>=1;i--)c.lineTo(i/12*length,r*(.65+.3*Math.sin(i*2.3+phase*6+1.7)));
    c.lineTo(0,3);c.closePath();c.fill();
    for(let i=0;i<RANGED_VISUALS.flameTongues;i++){
      const t=(i+phase)/RANGED_VISUALS.flameTongues,x=t*length;
      const y=reduced?Math.sin(i*2.4)*r*.28:Math.sin(i*2.4+time*12)*r*.35;
      const width=length/RANGED_VISUALS.flameTongues*.95,height=r*(.4+.2*Math.sin(i*1.7));
      c.fillStyle=i%3===0?'#fff0ad':'#ffc55a';c.beginPath();
      c.moveTo(x-width,y-height);c.lineTo(x+width*.55,y-height*.35);c.lineTo(x+width,y);c.lineTo(x+width*.25,y+height*.5);c.lineTo(x-width,y+height);c.closePath();c.fill();
    }
    c.fillStyle='#ffe7a0';c.fillRect(0,-3,Math.min(length,28),6);
  }else{
    c.fillStyle='#9d203e';c.fillRect(0,-r,length,r*2);
    c.fillStyle='#ff385c';c.fillRect(0,-r+1,length,Math.max(1,r*2-2));
    c.fillStyle='#ff96ae';c.fillRect(0,-r*.55,length,r*1.1);
    c.fillStyle='#fff4ef';c.fillRect(0,-2,length,4);
    const phase=reduced?0:(time*RANGED_VISUALS.railRate)%1;
    c.fillStyle='#ffe2eb';
    for(let i=0;i<RANGED_VISUALS.railBands;i++){
      const x=(i+phase)/RANGED_VISUALS.railBands*length;
      c.fillRect(x,-r,3,r*2);
    }
    // A single brief discharge accent, with a quieter steady beam afterward.
    if(!reduced&&age<.08){c.globalAlpha=.35*(1-age/.08);c.fillStyle='#fff4ef';c.fillRect(0,-r,length,r*2);}
  }
  c.restore();return true;
}

export function drawRailCharge(c,charge,reduced=false){
  // Called in weapon coordinates: sequential capacitors lead the eye to the muzzle.
  const q=clamp(charge,0,1);
  c.fillStyle='#3e3643';c.fillRect(7,-7,15,14);
  c.fillStyle='#adb9c1';c.fillRect(17,-8,38,4);c.fillRect(17,4,38,4);
  for(let i=0;i<4;i++){
    const lit=q>(i+1)/5;
    c.fillStyle=lit?'#ffe0eb':'#a75c7d';c.fillRect(23+i*8,-10,3,20);
    if(lit){c.fillStyle='#ff496c';c.fillRect(22+i*8,-12,5,2);c.fillRect(22+i*8,10,5,2);}
  }
  c.fillStyle=q>0?'#ff6988':'#593a4b';c.fillRect(51,-4,6,8);
  if(q>0){
    const size=2+q*4;c.fillStyle='#ffe7ee';c.fillRect(55,-size/2,size,size);
    if(!reduced){c.strokeStyle='#ff7497';c.lineWidth=1;c.beginPath();c.moveTo(56+12*(1-q),-10*(1-q));c.lineTo(56,0);c.lineTo(56+12*(1-q),10*(1-q));c.stroke();}
  }
}

export function drawFlameWeapon(c,e,charge,time,reduced=false){
  const firing=e.flameLeft>0;
  c.save();c.rotate(e.angle||0);
  if(firing&&!reduced)c.translate(-1-Math.sin(time*24)*.6,0);
  c.strokeStyle='#d6aa68';c.lineWidth=3;c.beginPath();c.moveTo(-12,-3);c.bezierCurveTo(-2,-5,2,2,14,-2);c.stroke();
  c.fillStyle='#43443b';c.fillRect(11,-7,15,10);c.fillStyle='#827860';c.fillRect(20,-8,8,3);
  c.fillStyle=firing?'#fff0ad':charge>0?'#ffbe64':'#c77a49';c.fillRect(25,-5,7,7);
  // Small pilot flame becomes a pressurized ignition tongue, following the aim.
  const size=firing?12:charge>0?3+charge*6:3;
  c.fillStyle=firing?'#ffd26a':'#ff8e4f';c.beginPath();c.moveTo(32,-3);c.lineTo(32+size,0);c.lineTo(32,3);c.closePath();c.fill();
  c.fillStyle='#fff2be';c.fillRect(32,-1,Math.max(2,size*.45),2);c.restore();
}
