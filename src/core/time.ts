const pacificFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

export function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("invalid_timestamp");
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) throw new Error("invalid_timestamp");
  return normalized;
}
export function pacificDate(value: string): string {
  const parts = pacificFormatter.formatToParts(new Date(instant(value)));
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function nextPacificMidnight(now: string): string {
  const day = pacificDate(now);
  let low = Date.parse(instant(now)), high = low + 27 * 3_600_000;
  // Search the actual IANA day transition; no fixed UTC offset or 24-hour day.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (pacificDate(new Date(mid).toISOString()) === day) low = mid;
    else high = mid;
  }
  return new Date(high).toISOString();
}
/** Start bounds the earliest completion; stale nonfinal observations do NOT. */
export function completionDay(start: string | null, firstFinal: string | null, actual: string | null): string | null {
  if (actual) return pacificDate(actual);
  if (!start || !firstFinal || start > firstFinal) return null;
  return pacificDate(start) === pacificDate(firstFinal) ? pacificDate(firstFinal) : null;
}
