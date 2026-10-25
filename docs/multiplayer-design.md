# Multiplayer timing and recovery design

Baseline: main 527bd10727ee1f2266aeaf31882f9a7517bf10fb. The separately mentioned assessment was not attached to this request; the supplied implementation requirements and the source audit are the working specification.

## Decisions recorded before implementing compensation

Use **bounded whole-world rollback/replay for late parry edges**, not a historical hit test attached to already-applied damage. Retain at most 200 ms of complete simulation state and the controls actually used each tick. A validated parry edge can replace defensive input at an eligible retained tick; replay all subsequent simulation ticks, including HP/internal damage, streaks, death, projectile consumption/reflection, enemy stun, kills and rewards. The original engine and its parry windows decide the result. Area attacks, dash-only explosions and non-parryable projectiles keep their existing rules; historical input never makes them parryable.

Eligibility is tied to server-issued snapshot sequence/tick receipts and server-measured RTT, not arbitrary client wall-clock timestamps. The final permitted rewind is bounded by both measured transport/view delay and 200 ms. Historical positions, obstacles, enemy attack phases, projectile IDs/ownership and seeded RNG come from server history. Replay must never advance newly received movement retroactively. A parry alone may supply historical facing and guard activation.

External actions and room/membership transitions are commit barriers. No historical correction may cross a barrier, reconstruction, or run change. Irreversible action acknowledgments are durable. Within a correction interval, the authoritative state may correct provisional HP or a provisional death; clients must apply the complete revised state and clear obsolete predicted feedback. Result actions wait until the correction interval closes. Cosmetic combat events are held until outside the correction window, then delivered with stable per-run IDs and acknowledgments. Sounds already committed are never replayed or retroactively undone.

Tradeoffs: this is more CPU/memory intensive than positional lag compensation, and holding confirmed combat effects adds latency. Local action startup is predicted immediately, but successful hit/parry outcomes remain authoritative. The cap cannot guarantee fairness at every RTT. Corrections beyond the cap or across commit barriers are rejected; no healing or contradictory partial acceptance is permitted. Profile the full replay cost under four-player Endless load.

## Clock and lifecycle

One non-overlapping timer loop uses an accumulator and exact 1/60-second engine steps. Inputs queued between callbacks are installed only after elapsed ticks have advanced. Normal input sends target 30 Hz, snapshots 20 Hz, checkpoints one second; transitions persist promptly. Catch-up is capped at six ticks per callback with explicit telemetry for discarded excess time. This overload policy is not cosmetic hit pause.

With no live controllers the room stops timers after neutralizing controls and persisting. No unseen combat is simulated while nobody is connected. Characters remain vulnerable while any teammate is connected; reconnect never heals or resets combat. Membership survives 90 seconds of transport absence. Grace members do not block reward choices, drafts, altar decisions or door consensus; they retain inventory/HP. Party wipe is evaluated from living characters, including grace characters, so disconnecting does not revive a dead player. Explicit leave removes membership immediately and transfers host.

Cloudflare timers prevent hibernation while active. Alarms are for idle grace/auth deadlines, not 60 Hz combat. Reconstructed rooms restore persisted state, discard old prediction/rollback history, establish a fresh transport epoch and require full resynchronization.

## Platform references checked

- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ — active timers prevent hibernation; no shutdown hook is guaranteed.
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/ — hibernatable sockets and serialized attachments.
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ — input/output gates, allowUnconfirmed and sync. Periodic checkpoints may allow unconfirmed network output; transition confirmation awaits storage.
- https://developers.cloudflare.com/workers/runtime-apis/websockets/ — do not assume browser bufferedAmount exists on server sockets. Use a bounded application acknowledgment window and disconnect stalled receivers.
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ — native admission rate binding, approximate per-location limits.

Implementation status and measured verification will be recorded separately; this document describes the chosen policy, not proof that it has passed testing.

## Implemented refinements

Commands are produced at 60 Hz and batched at 30 Hz; only the newest four queued
commands per player survive overload. A validated late defensive edge is replayed
immediately on receipt, without advancing time or applying its movement. It does
not wait behind movement commands. The future queue consumes the compensated
counter once. The reported view tick follows the actual interpolated frame and
is constrained by a server-issued receipt. A socket may have at most four
unacknowledged snapshots; HTTP snapshot sequences do not consume socket credits.
Reconstruction resets socket credits, RTT probes and receipt history. Scene
changes clear interpolation history. Duplicate input packets cannot refresh held
controls. Final evidence and remaining limits are in `multiplayer.md`.
