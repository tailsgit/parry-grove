# Performance implementation and fidelity contract

This game uses Canvas 2D, not meshes, materials, shadow maps, or shaders. The
optimization keeps every sprite, effect, particle count, lifetime, camera scale,
existing device pixel ratio limit, color, animation and combat timing intact.

## Prioritized implementation plan (implemented)

| Priority | Files | Structural change |
| --- | --- | --- |
| 1 | `game/performance.js`, `game/renderer.js` | Cache ordered scenery commands in reusable typed arrays; replay the original native `fillRect` primitives, skipping redundant color assignments. At exact integer device-pixel transforms only, omit tile fills identical to the opaque background. Preserve the original immediate rasterization for fractional coordinates. |
| 2 | `game/performance.js`, `game/engine.js` | Spatial grid for separation and swept returned-projectile broad phase at 32+ enemies. Reuse buckets and query arrays. Keep source-index ordering and the original distance checks, tie rules and collision priority. Use the cheaper linear path for small encounters. |
| 3 | `game/engine.js`, `game/renderer.js` | Pool bullets, enemies, hazards, combat events, particles, floating text and rings. Compact arrays in place instead of allocating `filter` results. Prewarm local games; deserialized server snapshots initialize pools lazily. Grow on demand without dropping entities or effects. |
| 4 | `game/engine.js` | Replace nearest-target and firing-queue sorting with linear selection; reuse melee candidates, alive-player lists, peer snapshots, prediction results and beam endpoint storage. Remove temporary objects from swept-distance and line-of-sight checks. |
| 5 | `game/renderer.js`, `game/Game.jsx` | Reuse sorted entity references, camera/aim points, solo input envelopes and co-op extrapolation objects. Hoist sound definitions and event lists. Preserve immutable React HUD snapshots. |
| 6 | `game/renderer.js` | Conservative viewport rejection for wholly off-screen bullets and particles. Include rotated projectile size and shake overscan. Keep their simulation and lifetimes active. |
| 7 | `tests/performance.test.js`, `tests/performance-scenario.js`, `tests/fixtures/performance-parity.json`, `scripts/performance-benchmark.mjs` | Original-state fingerprints, pool reuse checks, spatial candidate/order checks and reproducible simulation benchmark. |

GPU mesh instancing and 3D frustum culling are not applicable. The complete arena
normally fits on the canvas. Cover is drawn before characters, so characters are
visually in front of it; treating cover as an occluder would change the image.
No speculative occlusion or material reordering is used.

## Fidelity verification

A local browser harness compared original and optimized canvas pixels in five
room themes, at fractional and integer viewport sizes, with DPR 1, 1.5 and 2.
It exercised weapon drawing, perfect-parry flashes, particles, text, screen shake,
hit-stop and scenery seed changes: **120 comparisons, zero differing channels**.

Bitmap floor caching and combined Path2D drawing were investigated and rejected
because their rasterization changed edge pixels. The retained command batch uses
the original primitive order and drawing API.

The simulation matches original state fingerprints at ticks 60, 120, 600 and
1200 with 12, 32 and 180 enemies. Additional checks compared every tick in the
12- and 180-enemy scenarios. Collision priorities and floating-point accumulation
order are preserved. All existing gameplay, playthrough and HTTP/D1 tests pass.

## Measurements

Local Node benchmark: median of seven trials, 100 warm-up ticks, then 1200 timed
ticks with identical seeded setups. These are stress fixtures, not normal room
sizes or measured end-to-end FPS.

| Enemies | Original simulation | Optimized simulation | Speedup |
| --- | --- | --- | --- |
| 12 | 16.95 ms | 14.07 ms | 1.20x |
| 180 | 1394.45 ms | 780.53 ms | 1.79x |
| 400 | 6522.41 ms | 2734.25 ms | 2.39x |

A separate fresh-canvas browser benchmark measured renderer CPU submission time,
not GPU completion or display FPS. Final medians were 0.362 to 0.288
ms/frame at 12 enemies and 1.757 to 1.620 ms/frame at 180 enemies. At the
aligned viewport, floor rectangles fell from 739 to 580 and color assignments
from 1016 to 501. Hardware,
viewport, browser acceleration and scene composition affect these numbers.

Run the simulation benchmark against an exported original engine:

```sh
node scripts/performance-benchmark.mjs /path/to/baseline/game/engine.js
```

The baseline engine needs its matching `config.js` in the same directory. Omitting
the argument measures only the current engine. Baseline: UI update commit
`fa04ddfcd21c5324ff4965e869497a4acd2140ae`.

## Memory and complexity limits

Pooling removes entity/VFX churn after warm-up within reserved capacity. The
pools grow on exhaustion rather than silently truncating visuals. Browser API
objects, audio nodes, damage text strings, React HUD snapshots and JSON transport
still allocate; this is not a claim of zero allocations across the entire app.
Runtime data lives in WeakMaps and renderer instances, outside serialized games.

Grid separation is O(n + local candidates), plus candidate ordering. If every
enemy overlaps in one cell, the exact interaction set is still O(n²); it is not
safe to omit those interactions. This optimization mainly removes checks of
spatially distant enemies. Existing fixed-step frequency remains unchanged.

The development-only browser harness is `tests/renderer-fidelity.html`. Serve it
from a temporary folder containing `game/` pointing at the optimized game modules
and `baseline/` containing the original renderer and its config. It never loads
in the production game. It reports pixel differences and CPU renderer timings.
