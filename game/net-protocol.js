export const NET = Object.freeze({
  version: 2,
  hz: 60,
  dt: 1 / 60,
  inputMs: 33,
  queuedTicks: 4,
  snapshotMs: 50,
  checkpointMs: 1000,
  authMs: 3000,
  silenceMs: 1500,
  graceMs: 90000,
  watchdogMs: 5000,
  maxSockets: 8,
  maxBody: 12000,
  maxMessage: 4096,
  maxCatchup: 6,
  rewindTicks: 12,
  eventLimit: 256,
  eventBatch: 64,
  inflight: 4,
});
export const ACTIONS = new Set([
  "ready",
  "weapon",
  "start",
  "upgrade",
  "buy",
  "kit",
  "route",
  "sacrifice",
  "sacrificeDecline",
  "vendorClose",
  "retry",
  "return",
  "admin",
  "leave",
]);
export const ACTIVE_ACTIONS = new Set([
  ...ACTIONS,
  "input",
  "poll",
  "resume",
  "join",
]);
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function protocol(value) {
  if (value !== NET.version)
    throw Object.assign(
      Error("Game updated. Refresh this page to reconnect."),
      { status: 426 },
    );
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
export function validateInput(i) {
  if (!i || typeof i !== "object" || Array.isArray(i))
    throw Error("Invalid controls.");
  for (const [key, min, max] of [
    ["mx", -1, 1],
    ["my", -1, 1],
    ["angle", -Math.PI * 2, Math.PI * 2],
  ])
    if (
      i[key] !== undefined &&
      (!Number.isFinite(i[key]) || i[key] < min || i[key] > max)
    )
      throw Error("Invalid " + key + ".");
  for (const key of ["attack", "guard"])
    if (i[key] !== undefined && typeof i[key] !== "boolean")
      throw Error("Invalid " + key + ".");
  for (const key of ["attackPress", "parry", "dash", "interact"])
    if (i[key] !== undefined && !integer(i[key], 0, 1e9))
      throw Error("Invalid " + key + ".");
  return i;
}
export async function readBody(request, max = NET.maxBody) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Missing request body.");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw Object.assign(Error("Request too large."), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const body = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Error("Invalid request.");
  return body;
}
export function neutralInput(p, i = {}) {
  return {
    mx: 0,
    my: 0,
    angle: p?.angle || 0,
    attack: false,
    guard: false,
    attackPress: Math.max(i.attackPress || 0, p?.seenAttack || 0),
    parry: Math.max(i.parry || 0, p?.seenParry || 0),
    dash: Math.max(i.dash || 0, p?.seenDash || 0),
    interact: Math.max(i.interact || 0, p?.seenInteract || 0),
  };
}
export class TokenBucket {
  constructor(rate, burst = rate) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = 0;
  }
  take(now, cost = 1) {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.at) * this.rate) / 1000,
    );
    this.at = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
