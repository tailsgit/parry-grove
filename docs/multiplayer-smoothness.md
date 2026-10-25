# Multiplayer smoothness follow-up

Base: main `0ce6047` (merged PR #37). This pass retains the 60 Hz authoritative
simulation, local prediction/reconciliation, remote interpolation, original
combat balance and solo-only hit pause. It implements priorities 1–5 and evaluates
priority 6 without replacing the transport. The [previous report](multiplayer.md)
is historical evidence rather than the current input/effect policy.

## 1. Input pipeline: remove waits, then measure

The original 109 ms local-browser median included three avoidable waits: a 33 ms
client batching interval, installation after the next server callback, and
consumption of a multi-tick backlog before a periodic snapshot. Tracing the first
revision showed receive-to-tick waits around 45–56 ms even after faster batching.

Now:

- DOM parry/dash/attack presses immediately queue and send an edge command, with
  zero-duration local startup prediction. This does not advance movement/physics.
- Fixed-step commands sampled by a rendered frame flush in that frame; a 16 ms
  maintenance pump handles retries/watchdog, not an artificial movement hold.
- The server advances elapsed ticks with the old controls, then installs the
  newest fresh sample for the next eligible tick. Cumulative action counters
  preserve an edge when older movement samples are coalesced. It never applies
  newly received movement to elapsed history or adds simulation ticks.
- An applied input prompts an authoritative snapshot rather than waiting for the
  50 ms periodic broadcast. Snapshot credits still bound slow receivers. Moving
  clients can receive up to 60 snapshots/sec; idle updates remain near 20/sec.
- Command traces carry client creation/send timestamps, server receive/apply/
  broadcast timestamps, and client receipt measurements. Cross-machine clock
  values are not directly subtracted; server segment times use the server clock,
  and the full loop uses the originating client's clock. Repeated snapshot echoes
  of one sequence do not become additional latency samples.

The ordinary per-member message bucket increases from 60/s (burst 120) to 90/s
(burst 180) for 60 Hz command traffic plus probes/acks. Discrete action limits,
body limits, authentication, ownership and shared authority are unchanged.

### Measurements

| Controlled local measurement | Before | After |
|---|---:|---:|
| Four native-RAF browser contexts: acknowledgment median | 109.2 ms | 28.9 ms |
| Four DO/socket clients, no renderer: acknowledgment median | Not captured in this form | 20.75 ms |
| Same server/socket test: p95 / maximum | — | 26.48 / 53.90 ms |
| Equivalent full snapshot: mean JSON / binary bytes | JSON only | 6,055 / 2,391 (about 60% smaller) |

The **median** loopback target below 30 ms was met in these samples. This is not a
promise that every input or device stays below 30 ms. Browser samples include
headless/CDP scheduling; server/socket measurements omit rendering. Higher
snapshot frequency offsets some per-packet savings, so do not infer a 60%
reduction in total traffic. [Pipeline data](multiplayer-smoothness/pipeline.json)
and [browser data](multiplayer-smoothness/native/results.json) retain the evidence.

## 2. Immediate presentation and authoritative effects

Local weapon startup/departure audio remain immediate. Nearby melee contact can
produce a restrained neutral tentative contact flash; this predicts neither a
successful hit nor damage, stun, rewards, a green parry, or a streak increment.
There is no multiplayer micro hit-stop or shared pause.

Server combat events publish in their simulation tick instead of waiting twelve
history ticks. Clients render them upon receiving the authoritative snapshot.
The 200 ms history remains exclusively for eligible defensive correction and
provisional result settlement; it is not a universal cosmetic timer.

Publishing sooner has an explicit tradeoff: a later valid defensive correction
can invalidate an already displayed damage effect or sound. Event identities are
stable across unchanged replay; replay removes obsolete pending events, assigns
fresh IDs to changed outcomes, and clients clear transient feedback on correction.
Already played sound cannot be undone. A cache is bounded to 1,024 event identities;
the delivered event ring remains 256. Unchanged effects and startup sounds must
not be replayed through confirmation. Startup deduplication also uses action
counters, because coalescing can change the sequence that carries an edge.

HP/internal damage, perfect/regular outcome, streaks, reflection and ownership
remain server decisions. Damage/timer streak resets, parry windows, damage/ranges,
Story/Endless rules and solo-only hit pause are unchanged.

## 3. Frame-rate-independent rendering

Correction offsets decay by `exp(-17.260924 * dt)` (equivalent to the old 0.75 per
60 Hz frame), independent of the renderer's frame count. Large corrections,
teleports, scene/epoch changes and defensive corrections retain hard resets.
Local position interpolates the last two fixed physics positions with the
accumulator alpha; action startup remains immediate. Zero-duration DOM edge
prediction does not manufacture an additional movement step.

Tests compare decay at 30/60/120/144 FPS, sample local accumulator interpolation,
and prove renderer reuse never mutates authoritative state. A four-context run
also used timer-driven 30/60/120/144 render cadences. This exercises the code paths;
it is **not physical monitor refresh-rate certification**.

## 4. Allocation work and binary snapshots

- Rollback history reuses thirteen nested snapshot containers instead of
  JSON-stringifying/parsing the complete world every ordinary tick. Nested arrays
  and objects remain independently owned. Replay refills existing history
  containers; one working world copy is still allocated for a correction, using a direct
  recursive copy instead of a temporary JSON string.
- Compact entity field lists are hoisted, compacting uses direct loops, and a
  per-tick/revision cache shares compact world construction between receivers.
- Client display entities/arrays and snapshot lookup maps are reused rather than
  creating four pairs of Maps plus every display entity on every rendered frame.
- Noncritical React HUD updates are limited to about 80 ms; HP, internal damage,
  streak successes, scrap, phase/member changes still trigger immediate updates.
- Snapshots negotiate a self-contained binary codec, using a reusable ArrayBuffer
  writer/DataView, static field IDs and 16-bit quantized positions/velocities.
  Maximum positional rounding error is 1/32 world pixel; velocity error is 1/8
  world unit/sec. Out-of-range values use float64. Health/timers/progression are
  not quantized. The authoritative simulation is never quantized.
- HTTP and nonnegotiating/unknown-codec sockets retain JSON. Binary format version
  1 is advertised explicitly and checked; dictionary changes require a codec
  version bump. Full snapshots need no delta baseline recovery logic.

Chrome DevTools Protocol timeline profiling (one of four contexts) observed 265
GC events, 748 ms total and a 33.35 ms maximum pause in that profiled run. Profiling
itself increased the browser acknowledgment median to 58.1 ms; do not use that
number as unprofiled network latency. The profile predates the final display-buffer
reuse change, so **no measured GC improvement percentage is claimed**. Workerd
rollback/serialization executes outside the Chrome renderer; its tick/replay
cost is measured separately. GC stutter has been reduced structurally, not proven
eliminated on all devices. [Profile summary](multiplayer-smoothness/browser/results.json).

The accelerated four-player 30-room engine soak ran 56,248 ticks, 462 ten-tick
replays, with 13 history containers created and 56,235 reused. Tick median/p95/max:
0.155/0.412/11.550 ms; replay: 1.847/3.616/10.081 ms. An earlier revision still
reached a 114.6 ms replay outlier; removing its working-world JSON copy preceded
this final isolated run. These small local measurements do not prove GC spikes
impossible and are not a hard frame-time guarantee. This fixture boosts HP/damage and forces room
transitions after a cap; it is not a natural playthrough or a WAN endurance test.
[Soak data](multiplayer-smoothness/soak.json).

## 5. Remote jitter fallback

Use one simple approach: an EMA of snapshot interval and absolute arrival
deviation selects a bounded 20–100 ms jitter margin. It increases at most 4 ms
and decreases at most 1 ms per received snapshot to avoid abrupt buffer changes.
Buffer underruns are counted. No projectile, enemy attack transition or standard
movement is extrapolated in this version. A 200 ms ordered stall can still exceed
the buffer and hold remote entities; the margin cannot hide arbitrarily bad links.

## 6. WebSocket head-of-line evaluation

The harness delays an ordered message and subsequently holds newer messages
behind it, recording queued delay and messages behind a stall. This reproduces
the visible consequence of ordered delivery, **not a kernel TCP packet-loss
experiment**, and cannot establish the cause of a particular deployed stall.

WebSockets use ordered reliable TCP; a lost packet can block later data. The W3C
WebTransport design explicitly describes this limitation. An unreliable,
unordered WebRTC data channel or WebTransport datagrams can avoid retransmitting
obsolete state. However:

- Cloudflare's Workers protocol reference documents WebSockets and HTTP/3 requests,
  not an equivalent inbound WebTransport/RTCDataChannel session API on our room DO.
  HTTP/3 support alone does not establish WebTransport session support.
- A switch needs a compatible gateway/server transport endpoint, authenticated
  room routing, datagram sizing/fragmentation policy, sequencing, backpressure and
  browser fallback. It must preserve DO authority, not turn a player's browser
  into the gameplay authority.
- Keep progression/choices/purchases and reliable events on a reliable channel.
  Only independently decodable state should be eligible for unreliable delivery.

Decision: retain WebSockets for this PR. First collect deployed snapshot-gap,
RTT/jitter, underrun and correction telemetry. Prototype an unreliable snapshot
path only if real traces show ordered stalls remain a substantial problem after
these pipeline fixes. No transport migration was implemented or claimed tested.

Primary references checked:
- https://github.com/w3c/webtransport/blob/main/explainer.md
- https://www.w3.org/TR/webtransport/
- https://www.w3.org/TR/webrtc/
- https://developers.cloudflare.com/workers/reference/protocols/
- https://developer.chrome.com/docs/devtools/memory-problems

## Validation and delivery boundaries

Four actual Chromium contexts with local Durable Objects/WebSockets exercised
0/50/100/150 ms RTT, ±10 ms jitter, ordered 200 ms stall profiles at nominal 1%/2%,
combat kills, four independent rewards, route consensus, same-tab refresh and
temporary reconnect without identity/HP loss. Additional fixture scenes covered
boss rooms on Story floors 1/2/3 and Endless room 30, with all four players
connected and moving. Fixtures use boosted HP and direct scene setup, not a
complete campaign playthrough. Native and mixed-cadence runs had zero page errors.

[Mixed-cadence evidence](multiplayer-smoothness/mixed-cadence/results.json).
Build/typecheck/lint, focused test totals and the full-suite baseline comparison
are in [checks.json](multiplayer-smoothness/checks.json). Existing unrelated suite
failures are explicitly retained; no combat balance changes were made to silence
them. Test-only fixture hooks remain excluded from production.

Not verified: four humans on independent physical machines/connections, deployed
WAN/kernel packet loss, real 120/144 Hz monitors, Safari/Firefox/mobile, long network
sessions or many simultaneous rooms. The remaining GC/replay spikes and network
limits prevent a blanket claim of universally smooth or production-certified play.

Reproduce with `node scripts/multiplayer-pipeline.mjs`, the browser harness
(`PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE`; optional `MP_PROFILE`, `MP_FLOORS`,
`MP_MIXED_FPS`, `MP_OUTPUT`), and
`MP_OUTPUT=docs/multiplayer-smoothness node --expose-gc scripts/multiplayer-soak.mjs`.
