// Shared by the rail warning and the authoritative discharge. Keep the original
// four-pixel march and nine-pixel cover padding so presentation cannot change range.
export function beamEndpoint(g,e,angle,end={}) {
  end.x=e.x;end.y=e.y;
  const cosine=Math.cos(angle),sine=Math.sin(angle),maximum=Math.hypot(g.width,g.height);
  for(let length=24;length<maximum;length+=4){
    const x=e.x+cosine*length,y=e.y+sine*length;
    if(x<25||x>g.width-25||y<25||y>g.height-25||g.obstacles.some(o=>x>o.x-9&&x<o.x+o.w+9&&y>o.y-9&&y<o.y+o.h+9))break;
    end.x=x;end.y=y;
  }
  return end;
}
