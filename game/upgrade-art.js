const GLYPHS={
 heart:'M4 5h5l3 3 3-3h5v7l-8 8-8-8Z',
 blade:'M5 19 18 6l2-2v6L8 22M3 14l7 7M3 21l3-3',
 speed:'M3 7h10V3l8 9-8 9v-5H3M3 11h7',
 dash:'M9 3 3 12l6 9 6-9ZM18 6l4 6-4 6',
 shield:'M4 4h16v10l-8 7-8-7ZM8 8h8v6l-4 3-4-3Z',
 ring:'M7 3h10l4 5v8l-4 5H7l-4-5V8ZM9 8h6v8H9Z',
 star:'M10 2h4v6h6v4h-6v10h-4V12H4V8h6Z',
 fang:'M4 4h16v9l-4 7-3-7h-2l-3 7-4-7ZM8 7v4m8-4v4',
 clock:'M5 3h14M5 21h14M7 3v5l10 8v5M17 3v5L7 16v5M9 11h6',
 arc:'M3 18V8l6-5h6l6 5v10M3 13h18M8 18v3m8-3v3',
 return:'M10 4 3 11l7 7v-5h7v7h4V9H10Z',
 bolt:'M12 2 4 13h7l-1 9 10-13h-8Z',
 flag:'M5 22V3h14l-3 5 3 5H5',
 cross:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
 loop:'M5 7 9 3h9v7M18 3l-5 5M19 17l-4 4H6v-7M6 21l5-5',
 fire:'M12 2v7l5-4v7l4-2v8l-5 4H7l-4-5v-5l5 2v-4Z',
 crowd:'M3 4h5v5H3ZM16 4h5v5h-5ZM9 11h6v6H9ZM3 20h18',
 bleed:'M12 2 5 13v5l4 4h6l4-4v-5ZM8 16h3v3',
 snow:'M12 2v20M3 7l18 10M3 17 21 7M8 3l4 4 4-4M8 21l4-4 4 4',
 music:'M9 18V5l11-3v13M9 9l11-3M4 17h5v4H4ZM15 14h5v4h-5Z',
 prism:'M12 2 2 11l10 11 10-11ZM2 11h20M12 2 7 11l5 11 5-11Z',
 moon:'M18 3H9L3 9v7l5 5h9l5-5H12l-5-5V7h8Z',
 root:'M12 2v12M6 6l6 6 6-6M3 21l5-7h8l5 7M8 14v8m8-8v8',
};
const TYPES={vitality:'heart',edge:'blade',speed:'speed',dash:'dash',distance:'speed',armor:'shield',parry:'ring',cleanse:'star',vampire:'fang',perfection:'shield',stun:'clock',area:'arc',returnForce:'return',dashSpark:'bolt',punish:'flag',recovery:'cross',dashReset:'loop',fireTrail:'fire',crowdForce:'crowd',bleed:'bleed',chillParry:'snow',momentum:'speed',lastStand:'heart',perfectTempo:'music',dashCounter:'dash',chaoticReturn:'return',parryBeam:'bolt',lowHpArmor:'root',longIframes:'shield',parryCrystals:'prism',stunNova:'star',thunderStep:'bolt',rebound:'prism',echoBlade:'moon',mirrorEngine:'prism',stormHeart:'heart',bloodroot:'root',overdrive:'blade'};

export function upgradeGlyph(id){const type=TYPES[id]||'star';return GLYPHS[type];}
export function upgradeMark(id){const index=Object.keys(TYPES).indexOf(id);return index>7?`M${2+index%3*3} 1h2M${18-index%3*3} 23h2`:'';}
const canvasPaths=new Map();
export function drawUpgradeGlyph(c,id,size=28){c.save();c.translate(-size/2,-size/2);c.scale(size/24,size/24);c.strokeStyle=c.fillStyle;c.lineWidth=2;c.lineJoin='miter';if(typeof Path2D!=='undefined'){let path=canvasPaths.get(id);if(!path){path=new Path2D(upgradeGlyph(id)+upgradeMark(id));canvasPaths.set(id,path);}c.stroke(path);}else c.strokeRect(5,5,14,14);c.restore();}
