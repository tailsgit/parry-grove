# Parry Grove

A playable vertical slice of the attached 2D co-op roguelike design. One character,
three weapons, four randomized encounters, then the Brass Warden boss. Desktop
mouse and keyboard are required.

## Play online

**[Play Parry Grove on ChatGPT Sites](https://parry-grove.tailsails.chatgpt.site)**

Open the link on a desktop computer, sign in to ChatGPT with an account that has
access to the site, choose a weapon, and click **Play solo**. No installation is
needed. The site currently has restricted access; a room code does not grant
site access.

Move with **WASD**, aim with the **mouse**, hold **left click** to attack, press
**right click or Q** to parry, and press **Space** to dash. For co-op, choose
**Create co-op room**, share the six-character code with players who can access
the site, have everyone ready up, and let the host start the run.

The combat improvements in [PR #1](https://github.com/tailsgit/parry-grove/pull/1)
are on a separate branch and have not yet been published to the live game.

## Run locally

Requires Node.js 22.13+ (Node 24 is also tested). From this project folder:

```sh
npm install
npm run db:local
npm run dev
```

Open the address printed by the development server (normally
http://localhost:5173). `db:local` initializes the local online-room database;
run it once per fresh checkout. Solo runs do not require the database.
The committed pnpm lockfile is the reproducible dependency lock; pnpm users can
run `pnpm install --frozen-lockfile` instead of `npm install`.

Use Play solo for immediate gameplay. For co-op, create a room, open the same site
in another tab/browser/computer, and join with the six-character code. Choose
weapons, have everyone Ready up, then let the host Start the run. A local server
must be reachable by the other computers; a published site's audience must allow
those players access. Room codes do not bypass the site's access restrictions.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Mouse | Aim |
| Left click (hold) | Melee attack |
| Right click / Q | Parry once; tap again for another attempt |
| Space | Dash; movement direction or aim direction while stationary |
| E / Next room button | Continue once all surviving players chose rewards |
| Escape | Pause/resume solo only |

Face the source of a projectile. The first 90ms of a guard are perfect (green),
with the rest regular (orange); guard length depends on the weapon. A successful
parry grants 60ms of immunity and redirects a projectile in your aim direction. Perfect parries increase
melee damage by 16% per streak count; regular parries deal 8% immediate damage
and store 65% in the Internal Damage meter. An unguarded hit releases the entire
meter. Melee hits clear 8 internal damage, and it decays after 2.5s without a
regular parry. Orange mortar circles cannot be parried. Step or dash away.

## Implemented

- Shared pure simulation: movement, aimed melee, collision against stone cover,
  dash immunity, weapon-specific parry windows/effects, deflected projectiles,
  perfect streaks, regular parries, Internal Damage, levels and per-player upgrades.
- Dagger / Sword / Long Sword: different reach, sweep, damage, timing and perfect
  parry effects. Player weapons are melee only; deflection is their ranged counter.
- Five ranged enemies: archer, pistol, homing seeker, scatter shotgun, mortar.
  Telegraphs, projectile collision, cover, and marked unparryable AOE hazards.
- Seeded random cover and room enemy placement/composition, progressive difficulty,
  eight rewards, and a two-phase machine-gun boss after four rooms.
- Party-size scaling at each room entrance: larger arena, more enemies, modest
  health scaling, and boss adds/health. Death/victory and fresh restarts.
- Online rooms for 1–4 independent clients, readiness, host-only start, invalid/full
  code errors, consistent combat snapshots, individual rewards, player colors,
  heartbeat disconnects, and automatic host transfer.
- Procedural pixel characters/arena, particles, green/orange guard arcs, text cues,
  health bars, sound effects, small shake and cosmetic perfect-parry hit-stop.

## Architecture and tuning

| File | Responsibility |
| --- | --- |
| `game/config.js` | Balance values, enemy/weapon definitions, upgrade registry |
| `game/engine.js` | Shared fixed-step combat, room generation and progression |
| `game/renderer.js` | Canvas 2D pixel art, visual feedback and synthesized sound |
| `game/Game.jsx` | React screen, controls, solo loop, online transport, HUD |
| `game/rooms.js` | Lobby state, readiness, timeout, host transfer, input validation |
| `app/api/room/route.ts` | Server-authoritative room API and atomic revision updates |
| `db/schema.ts` / `drizzle/` | Room database schema and deployment migration |

React/Vinext provides the shell and server routes; the game itself uses Canvas 2D
and a small dependency-free simulation rather than a full game framework. This
keeps collision/combat reusable in browser solo play and the authoritative server
without duplicating mechanics or requiring a headless rendering framework.

The deployed server uses Cloudflare Workers and D1. Each input request advances
shared simulation at up to 60Hz, with bounded catch-up. Revision compare-and-swap
prevents concurrent clients from overwriting a room. Clients cannot submit HP,
enemy positions, damage, or upgrade effects. Session tokens authorize a player's
own inputs and stay out of public snapshots. Online snapshots use HTTP polling
(65ms gap plus round-trip time) with short local movement extrapolation. Co-op
latency is higher than local solo play; this is a prototype transport, not a
competitive action-game backend. The room API is isolated so WebSocket transport
can replace polling without rewriting combat.

## Decisions where the design was unspecified

- Four regular rooms and one deterministic area boss finish the slice. There is
  one colorful courtyard area; random cover changes its lanes each encounter.
- Perfect means the first 90ms after pressing parry. The guard covers a forward
  130-degree half-angle; attacks from behind bypass it. Streaks end after 3s
  without a perfect parry, a missed guard, a regular parry, or an unguarded hit.
- Default dash lasts 160ms with 100ms immunity. Upgrades can extend immunity to
  300ms and extend dash duration as needed so that increased immunity is usable.
- Dagger perfect parries add two streak counts; Sword clears 8 internal damage;
  Long Sword knocks back nearby enemies. Perfect deflections deal double damage.
- Allies cannot revive mid-fight. Surviving players select rewards; fallen players
  revive with half maximum HP in the next room. Survivors heal 8 HP on transition.
- Upgrades are independent random choices. All survivors must choose before
  anyone can press E to advance; E works anywhere after the reward phase.
- Levels require four kills and grant +5 maximum HP, +5% damage, and 10 healing.
- A 12s missed heartbeat disconnects a player. A returning page gets a clear
  disconnection message; rejoining an active run is deliberately unsupported.
- A backgrounded solo tab pauses. Online runs do not pause; if all clients stop,
  catch-up is capped so the party does not receive minutes of damage at once.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
node tests/build-smoke.mjs
```

Tests cover combat interactions, swept projectile collision, one-time upgrades,
progression, death/restart, 5,000 integrated ticks, and normal-health bot victories
with all three weapons. The multiplayer test runs the real API in an offline
Worker emulator with a real local D1 database: four concurrent clients, full and
invalid rooms, host permissions, 60 concurrent input requests, reward barrier,
room transition, host leave/timeout, and clean restart. The production smoke test
checks rendered menu HTML and the built Worker room endpoint. No production
cheat/debug endpoints are added for testing.

Arena rendering was inspected at wide and compact dimensions. An interactive
browser was unavailable in the development environment, so browser input, audio
playback, CSS layout, and real cross-internet co-op still need human playtesting.

## Still to expand

Multiple characters/areas/bosses, authored sprites and animations, persistent progression, mid-run reconnect, and extensive
balance/playfeel testing are not included. The design's complete initial content
list is present, but the transport and timing need real-player latency testing.

Next: playtest parry windows/dash timing with humans, upgrade the room transport
to a WebSocket authoritative room service with input prediction/reconciliation,
then add a second area and boss after the combat tuning settles.
