import { vi } from "vitest";

export const FIXED_UTC = "2026-10-21T12:00:00.000Z";

function utcDate(instant: string): Date {
  const date = new Date(instant);
  if (!instant.endsWith("Z") || !Number.isFinite(date.getTime())) {
    throw new Error("A valid explicit UTC timestamp is required");
  }
  return date;
}

export function freezeUtc(instant = FIXED_UTC): void {
  vi.useFakeTimers();
  vi.setSystemTime(utcDate(instant));
}

/** Formats test instants only; contains no Beam expiration calculation. */
export function pacificParts(instant: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(utcDate(instant)).map(({ type, value }) => [type, value]),
  );
}
