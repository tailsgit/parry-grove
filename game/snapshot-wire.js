// Self-contained, negotiated binary snapshots. No delta baselines to lose during
// reconnect. Static field IDs replace repeated JSON keys; unusual keys remain legal.
export const SNAPSHOT_WIRE_VERSION = 1;
const FIELDS =
  "Closed POST Upgrade accepted ack action actionAck actionId actionSequence actionSequences actions active admin allowAdmin altarOffers altarOpen altarResolved altarUsed angle appliedAt areaScale armed armor at attackBoostLeft attackCd attackPress attackSlowLeft auth authFailures auth_failure availableExits bleedLeft blocking broadcastAt bullets buried burnLeft bytes chainLeft checkpointVersion chillLeft chillTarget choice chosen cleanse close_state_error closed cloudDrag cloudflare code combat combatRoom component controller correction createdAt crystals curse curses damage danger dash dashAge dashBufferLeft dashCd dashCounter dashCounterReady dashIframes dashLeft dashOnly dashPower dashPulse dashSlowLeft dashTime deadline death deathInfo difficultyBudget digSurfaceLeft disconnected doomSnail doorConsensus doorsOpenedAt droppedMs dx dy echoBlade elite emitted emittedAt encounterParty enemies epoch error eventAck eventFloor eventGap eventGaps eventSerial events ex exit ey fatal fireTrail flameLeft flight flightElapsed flightTotal fx game guardHeld guardLeft hazards headers healthDamageTotal healthFactor height host hostId hp id index input inputCoalesced inputSeq inputSequence inputs interact internal intro invuln item itemId join kills kind kit kitId kitpickup kits l3Tell lastAck lastHit lastParryTime lastRegular lastSacrificeRoom lastShopRoom leave left level lobby longIframes lowHpArmor lowHpDamage magnetLeft maxHp maxSnapshotBytes maxTickMs meleeBufferLeft members message metadata_error metrics mineState mineTimer minionCd mirror missedParryLeft momentumDamage multiplayer name noKillTimer obstacles occurredAt offers operation overruns owner parry parryAge parryBeam parryBufferLeft parryCd parryCounter parryCrystals parryHeal parryLeft parrySuccess pendingCombatRoom pendingRoom perfect perfectOnly perfects persistMs persistenceErrors persistence_error phase ping players poll pong primed probe probeAt probeReply purchase r radius rarity ready receivedAt recoil reconnects reflected regulars rejectedRewinds remaining remainingSpawnGroups replayedTicks repositionLeft repositionX repositionY resume retry return returnPower revision rewinds ricochet room roomPhase roomStartedAt room_metrics roomenter routeDoors routeOptions routeRevived rtt runId runSeed runStats runSystems runType sacrifice sawFriendly scenerySeed scrap seed seenAttack seenDash seenInteract seenParry segmentCount sent sentAt seq sequence sequences serverTime session settled shieldBroken shieldDamage shieldRestore shopContacts shopStartedAt shortBeam slot slow_client snapshot snapshotBytes snapshots source sourceKind spawnWarnings speed stage staleInputs station status stock stopSerial streak streakLeft string stun stunBonus stunDamage stunNova swing sx sy teleport tell tellHorizontal tellTotal tellX tellY text thrower thunderStep tick tickMs tick_error ticks time token total trace transport triggerRadius true type unparryable upgrade upgrades vampire vendorOpen version victory viewSequence viewTick vx vy wall wave waveAge weapon weaponAction webSocket websocket who width wormActiveSegment wormCharge wormHeadId wormInvulnerable wormPhase wormSegmentIndex wormSegmentsDefeated wormShotCd wormShotUnparryable wormWindupKick x xp y".split(
    " ",
  );
const IDS = new Map(FIELDS.map((k, i) => [k, i + 1]));
const utf8 = new TextEncoder(),
  text = new TextDecoder("utf-8", { fatal: true });
const MAX = 2 * 1024 * 1024;
class Writer {
  constructor() {
    this.buffer = new ArrayBuffer(16384);
    this.view = new DataView(this.buffer);
    this.at = 0;
  }
  room(n) {
    if (this.at + n > MAX) throw Error("Snapshot exceeds wire limit");
    if (this.at + n > this.buffer.byteLength) {
      const b = new ArrayBuffer(
        Math.min(MAX, Math.max(this.at + n, this.buffer.byteLength * 2)),
      );
      new Uint8Array(b).set(new Uint8Array(this.buffer, 0, this.at));
      this.buffer = b;
      this.view = new DataView(b);
    }
  }
  byte(n) {
    this.room(1);
    this.view.setUint8(this.at++, n);
  }
  uint(n) {
    do {
      const b = n % 128;
      n = Math.floor(n / 128);
      this.byte(b | (n ? 128 : 0));
    } while (n);
  }
  string(s) {
    const b = utf8.encode(s);
    this.uint(b.length);
    this.room(b.length);
    new Uint8Array(this.buffer, this.at, b.length).set(b);
    this.at += b.length;
  }
  value(v, key = "") {
    if (v == null) {
      this.byte(0);
      return;
    }
    if (v === false) {
      this.byte(1);
      return;
    }
    if (v === true) {
      this.byte(2);
      return;
    }
    if (typeof v === "number") {
      const scale = [
        "x",
        "y",
        "sx",
        "sy",
        "ex",
        "ey",
        "tellX",
        "tellY",
      ].includes(key)
        ? 16
        : ["vx", "vy"].includes(key)
          ? 4
          : 0;
      if (scale && Number.isFinite(v) && Math.abs(v * scale) <= 32767) {
        this.byte(8);
        this.room(2);
        this.view.setInt16(this.at, Math.round(v * scale), true);
        this.at += 2;
        return;
      }
      if (Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff) {
        this.byte(3);
        this.uint(v);
        return;
      }
      this.byte(4);
      this.room(8);
      this.view.setFloat64(this.at, v, true);
      this.at += 8;
      return;
    }
    if (typeof v === "string") {
      this.byte(5);
      this.string(v);
      return;
    }
    if (Array.isArray(v)) {
      this.byte(6);
      this.uint(v.length);
      for (const x of v) this.value(x);
      return;
    }
    this.byte(7);
    let count = 0;
    for (const k in v) if (v[k] !== undefined) count++;
    this.uint(count);
    for (const k in v)
      if (v[k] !== undefined) {
        const id = IDS.get(k) || 0;
        this.uint(id);
        if (!id) this.string(k);
        this.value(v[k], k);
      }
  }
}
export class SnapshotEncoder {
  constructor() {
    this.writer = new Writer();
  }
  encode(message) {
    const w = this.writer;
    w.at = 0;
    w.byte(80);
    w.byte(71);
    w.byte(SNAPSHOT_WIRE_VERSION);
    w.value(message);
    return w.buffer.slice(0, w.at);
  }
}
export function decodeSnapshot(buffer) {
  if (ArrayBuffer.isView(buffer))
    buffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX)
    throw Error("Invalid binary snapshot");
  const v = new DataView(buffer);
  let at = 0,
    nodes = 0;
  const need = (n) => {
    if (at + n > v.byteLength) throw Error("Truncated snapshot");
  };
  const byte = () => {
    need(1);
    return v.getUint8(at++);
  };
  const uint = () => {
    let n = 0,
      m = 1;
    for (let i = 0; i < 5; i++) {
      const b = byte();
      n += (b & 127) * m;
      if (!(b & 128)) return n;
      m *= 128;
    }
    throw Error("Invalid integer");
  };
  const string = () => {
    const n = uint();
    need(n);
    const s = text.decode(new Uint8Array(buffer, at, n));
    at += n;
    return s;
  };
  function value(key = "", depth = 0) {
    if (depth > 64 || ++nodes > 200000)
      throw Error("Invalid snapshot structure");
    switch (byte()) {
      case 0:
        return null;
      case 1:
        return false;
      case 2:
        return true;
      case 3:
        return uint();
      case 4: {
        need(8);
        const n = v.getFloat64(at, true);
        at += 8;
        return n;
      }
      case 5:
        return string();
      case 6: {
        const n = uint();
        if (n > 100000) throw Error("Oversized array");
        const a = new Array(n);
        for (let i = 0; i < n; i++) a[i] = value("", depth + 1);
        return a;
      }
      case 7: {
        const n = uint();
        if (n > 10000) throw Error("Oversized object");
        const o = {};
        for (let i = 0; i < n; i++) {
          const id = uint(),
            k = id ? FIELDS[id - 1] : string();
          if (
            !k ||
            k === "__proto__" ||
            k === "constructor" ||
            k === "prototype"
          )
            throw Error("Invalid snapshot field");
          o[k] = value(k, depth + 1);
        }
        return o;
      }
      case 8: {
        need(2);
        const n = v.getInt16(at, true);
        at += 2;
        return n / (["vx", "vy"].includes(key) ? 4 : 16);
      }
      default:
        throw Error("Unknown snapshot tag");
    }
  }
  if (byte() !== 80 || byte() !== 71 || byte() !== SNAPSHOT_WIRE_VERSION)
    throw Error("Unsupported binary snapshot");
  const result = value();
  if (at !== v.byteLength) throw Error("Trailing snapshot bytes");
  return result;
}
