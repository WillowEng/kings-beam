import { describe, expect, it, vi } from "vitest";
import { createMockHttp, fetchWithTestTimeout } from "../support/http";
import { createNetworkGuard } from "../support/network";
import { freezeUtc } from "../support/time";
import { SYNTHETIC_CREDENTIALS } from "../support/diagnostics";

const route = { origin: "https://provider.invalid", pathname: "/scores" };

describe("scripted HTTP transport", () => {
  it("returns independent response bodies for repeated scripted requests", async () => {
    const mock = createMockHttp([
      { ...route, outcome: { kind: "json", body: { completed: false } } },
      { ...route, outcome: { kind: "json", body: { completed: true } } },
    ]);
    expect(await (await mock.fetch("https://provider.invalid/scores")).json()).toEqual({ completed: false });
    expect(await (await mock.fetch("https://provider.invalid/scores")).json()).toEqual({ completed: true });
    mock.assertConsumed();
  });

  it("simulates a transport error without contacting a service", async () => {
    const mock = createMockHttp([{ ...route, outcome: { kind: "network-error" } }]);
    await expect(mock.fetch("https://provider.invalid/scores")).rejects.toThrow("Synthetic transport failure");
    mock.assertConsumed();
  });

  it("simulates an abortable timeout under a controlled clock", async () => {
    freezeUtc();
    const mock = createMockHttp([{ ...route, outcome: { kind: "timeout" } }]);
    const pending = fetchWithTestTimeout(mock.fetch, "https://provider.invalid/scores", 5_000);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    mock.assertConsumed();
  });

  it("detects unconsumed expected requests", () => {
    const mock = createMockHttp([{ ...route, outcome: { kind: "json", body: [] } }]);
    expect(() => mock.assertConsumed()).toThrow("Expected mock HTTP steps were not consumed");
  });

  it("rejects unexpected requests without including secret-bearing arguments", async () => {
    const guard = createNetworkGuard();
    const mock = createMockHttp([], guard.deny);
    await expect(mock.fetch(`https://provider.invalid/scores?apiKey=${SYNTHETIC_CREDENTIALS.odds}`)).rejects.toThrow(
      "Unexpected network access blocked by test harness",
    );
    expect(mock.calls).toEqual([]);
    expect(() => guard.assertNoAttempts()).toThrow();
  });
});
