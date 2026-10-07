// Enemy contact alone does not break a streak: health must actually drop.
export function damageHealth(p,amount){
  const before=p.hp;
  p.hp=Math.max(0,p.hp-Math.max(0,amount));
  if(p.hp<before)p.streak=0;
}
