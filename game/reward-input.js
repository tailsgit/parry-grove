// Return a reward only while this player can still make a room-clear choice.
export function rewardShortcut(game,playerId,key,repeat=false){
 if(!game||game.phase!=='upgrade'||repeat||!/^[123]$/.test(key))return null;
 const p=game.players.find(p=>p.id===playerId);
 return p&&p.hp>0&&!p.chosen?p.offers[Number(key)-1]||null:null;
}
