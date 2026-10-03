// All balance values live here. Times are seconds; distances are world pixels.
export const BALANCE = {
  hp: 100, internalMax: 100, speed: 210, radius: 12,
  dashSpeed: 780, dashTime: .16, dashIframes: .1, dashCooldown: .85,
  perfectWindow: .09, parryIframes: .06, parryCooldown: .5, enemyShotGap: .18, deflectSpeed: 1.65, deflectAssistCone: .35, deflectAssistTurn: .18, parryCone: Math.PI * .72,
  blockReduction: .8, blockSpeed: .65, shieldCapacity: 100, enemyMeleeStun: 1, playerParryStun: .5,
  separationRadius: 64, separationSpeed: 110, enemyParryChance: .1, enemyParryRange: 115,
  regularChip: .08, regularStored: .65,
  meleeCleanse: 2, streakTimeout: 3, streakBonus: .16, hurtIframes: .32,
  bossSlamRadius: 145, bossSlamTell: .85, bossSlamCooldown: 3, bossRepositionSpeed: 230,
  encounters: 4, baseEnemies: 3, partyEnemies: 2, disconnectSeconds: 12,
};
export const WEAPONS = {
  dagger: { name: 'Dagger', damage: 31, range: 48, arc: .42, cooldown: .23, parry: .18, targets: 1, perk: 'Perfect parry: +1 streak', desc: 'Close range · highest damage · precise timing' },
  sword: { name: 'Sword', damage: 23, range: 72, arc: 1.35, cooldown: .34, parry: .28, targets: 3, perk: 'Perfect parry: clears 8 internal damage', desc: 'Balanced reach · small sweep · balanced timing' },
  longsword: { name: 'Long Sword', damage: 17, range: 100, arc: 2.2, cooldown: .46, parry: .4, targets: 99, perk: 'Perfect parry: pushes nearby enemies away', desc: 'Longest reach · wide sweep · forgiving timing' },
};
export const ENEMIES = {
  bow: { name: 'Archer', hp: 46, speed: 60, projectile: 190, damage: 12, rate: 1.8, tell: .55, color: '#f5cc65' },
  pistol: { name: 'Gunner', hp: 54, speed: 75, projectile: 350, damage: 13, rate: 1.8, tell: .4, color: '#fc9485' },
  homing: { name: 'Seeker', hp: 62, speed: 55, projectile: 170, damage: 12, rate: 2.2, tell: .6, color: '#c8a2ff' },
  shotgun: { name: 'Scatter', hp: 70, speed: 80, projectile: 310, damage: 9, rate: 2.3, tell: .55, color: '#f8b56e' },
  mortar: { name: 'Mortar', hp: 58, speed: 40, damage: 24, rate: 3, tell: .75, color: '#82d7ed' },
  brawler: { name: 'Brawler', hp: 58, speed: 96, melee: true, range: 90, arc: 1.8, damage: 16, rate: 1.5, tell: .3, color: '#dd9b72' },
  lancer: { name: 'Lancer', hp: 64, speed: 82, melee: true, range: 130, arc: .9, damage: 19, rate: 1.9, tell: .4, color: '#a9b9e8' },
  railgun: { name: 'Rail Turret', hp: 60, speed: 25, projectile: 850, projectileRadius: 9, damage: 25, rate: 3.2, tell: .35, color: '#ed7ca2' },
  boss: { name: 'The Brass Warden', hp: 550, speed: 95, projectile: 250, damage: 12, rate: .95, tell: .5, color: '#ffce72' },
};
export const UPGRADES = [
  { id: 'vitality', name: 'Heartwood', icon: '♥', desc: '+25 maximum health, then heal 10% of maximum HP.', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + p.maxHp*.1); } },
  { id: 'edge', name: 'Keen Edge', icon: '⚔', desc: '+20% melee damage.', apply: p => { p.damage += .2; } },
  { id: 'speed', name: 'Windrunner', icon: '↗', desc: '+15% movement speed.', apply: p => { p.speed += .15; } },
  { id: 'dash', name: 'Ghost Step', icon: '◇', desc: '+0.05s dash invulnerability, up to 0.3s.', apply: p => { p.dashIframes = Math.min(.3, p.dashIframes + .05); p.dashTime = Math.max(p.dashTime, p.dashIframes); } },
  { id: 'distance', name: 'Longstride', icon: '»', desc: '+30% dash distance.', apply: p => { p.dashPower += .3; } },
  { id: 'armor', name: 'Barkskin', icon: '⬡', desc: 'Reduce incoming damage by 10%, up to 50%.', apply: p => { p.armor = Math.min(.5, p.armor + .1); } },
  { id: 'parry', name: 'Stillwater', icon: '◎', desc: '+25ms perfect parry window, up to 165ms.', apply: p => { p.perfect = Math.min(.165, p.perfect + .025); } },
  { id: 'cleanse', name: 'Clear Mind', icon: '✦', desc: 'Melee hits clear 2 more internal damage.', apply: p => { p.cleanse += 2; } },
  { id: 'vampire', name: 'Vampire', icon: '♠', desc: 'Every kill restores 1% of maximum HP.', apply: p => { p.vampire = (p.vampire||0)+.01; } },
  { id: 'perfection', name: 'Perfection', icon: '✧', desc: 'Perfect parries restore 5 shield, up to 50 capacity.', apply: p => { p.shieldRestore = (p.shieldRestore||0)+5; } },
];
export const COLORS = ['#94e8cf', '#aebdff', '#ffd478', '#ffa5be'];
