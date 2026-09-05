/** Small numeric and collection helpers used across the shared package. */

/** Constrains `value` to the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Rounds to `digits` decimal places, avoiding float drift in stored data. */
export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Sums a list of numbers. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Builds a lookup map keyed by `id`, throwing on duplicate ids. */
export function indexById<T extends { id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`duplicate id: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

/** Formats a duration in seconds as a compact zh-CN string, e.g. `2小时30分`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  if (m > 0) return sec > 0 ? `${m}分${sec}秒` : `${m}分`;
  return `${sec}秒`;
}

/** UTC day key (`YYYY-MM-DD`) used for daily counters and reset logic. */
export function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Hour of day (0-23, UTC) used for bot activity windows. */
export function hourOfDay(epochMs: number): number {
  return new Date(epochMs).getUTCHours();
}

/**
 * True when `hour` falls inside a possibly wrapping [start, end) window.
 * `[22, 6)` means 22:00 through 05:59.
 */
export function inHourWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
