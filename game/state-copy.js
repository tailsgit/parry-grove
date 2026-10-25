// Rollback snapshots own their nested data. Reuse containers after the horizon;
// never share mutable arrays/objects with the live world or another history tick.
export function copyState(source, target, skipEvents = false) {
  if (source === null || typeof source !== "object") return source;
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) target = [];
    for (let i = 0; i < source.length; i++)
      target[i] = copyState(source[i], target[i]);
    target.length = source.length;
    return target;
  }
  if (!target || typeof target !== "object" || Array.isArray(target))
    target = {};
  for (const key in target) if (!(key in source)) delete target[key];
  for (const key in source) {
    if (skipEvents && key === "events") {
      target.events ||= [];
      target.events.length = 0;
      continue;
    }
    if (source[key] === undefined) delete target[key];
    else target[key] = copyState(source[key], target[key]);
  }
  return target;
}
export class HistoryPool {
  constructor() {
    this.free = [];
    this.created = 0;
    this.reused = 0;
  }
  capture(game) {
    const target = this.free.pop();
    if (target) this.reused++;
    else this.created++;
    return copyState(game, target, true);
  }
  release(game) {
    if (game && this.free.length < 14) this.free.push(game);
  }
}
