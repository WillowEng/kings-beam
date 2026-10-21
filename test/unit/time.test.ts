import { describe, expect, it, vi } from "vitest";
import { FIXED_UTC, freezeUtc, pacificParts } from "../support/time";
import { pacificDayIntervals, pacificScenarios } from "../fixtures/time";

describe("controlled time utilities", () => {
  it("fixes Date and advances scheduled callbacks deterministically", async () => {
    freezeUtc();
    expect(new Date().toISOString()).toBe(FIXED_UTC);
    const callback = vi.fn();
    setTimeout(callback, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(new Date().toISOString()).toBe("2026-10-21T12:00:01.000Z");
  });

  it.each(pacificScenarios)("formats $name", ({ utc, date, time }) => {
    freezeUtc(utc);
    const parts = pacificParts(new Date().toISOString());
    expect(`${parts.year}-${parts.month}-${parts.day}`).toBe(date);
    expect(`${parts.hour}:${parts.minute}:${parts.second}`).toBe(time);
  });

  it.each(pacificDayIntervals)("represents the $hours-hour $name day", ({ start, end, hours }) => {
    expect((Date.parse(end) - Date.parse(start)) / 3_600_000).toBe(hours);
    expect(pacificParts(start).hour).toBe("00");
    expect(pacificParts(end).hour).toBe("00");
  });

  it.each(["2026-10-21T12:00:00", "not-a-date"])("rejects an invalid or timezone-free instant", (instant) => {
    expect(() => freezeUtc(instant)).toThrow("A valid explicit UTC timestamp is required");
  });
});
