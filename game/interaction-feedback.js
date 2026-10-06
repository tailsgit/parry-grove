// Brief, pooled presentation effects; never alter gameplay or simulation RNG.
const profile=(color,count,radius,duration=.55,shape='rays')=>Object.freeze({color,count,radius,duration,shape});
export const INTERACTION_FEEDBACK=Object.freeze({
  kitpickup:profile('#80e4ed',18,48), upgrade:profile('#efd18b',22,52),
  purchase:profile('#efd18b',16,38), heal:profile('#88ed9c',18,38), repair:profile('#a6daff',18,38),
  sacrifice:profile('#d7a2ff',28,65,.75,'rune'), shopdeny:profile('#ff9b91',6,24,.35,'cross'),
  doorsopen:profile('#efd18b',8,35,.55), roomenter:profile('#efd18b',12,40,.45),
  level:profile('#88ed9c',26,60,.7), clear:profile('#efd18b',24,85,.7),
  levelclear:profile('#88ed9c',32,100,.8), victory:profile('#efd18b',40,120,.9),
});
export function interactionFeedback(event){return INTERACTION_FEEDBACK[event.kind==='purchase'&&(event.itemId==='heal'||event.itemId==='repair')?event.itemId:event.kind];}
