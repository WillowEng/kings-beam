import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { describe, expect, it, vi } from "vitest";
import { createNetworkGuard } from "../support/network";

describe("offline network guard", () => {
  it("installs blockers for fetch, HTTP(S), TCP and TLS entry points", () => {
    for (const entry of [globalThis.fetch, http.get, http.request, https.get, https.request, net.Socket.prototype.connect, tls.connect]) {
      expect(vi.isMockFunction(entry)).toBe(true);
    }
  });

  it("remembers attempts even when the immediate error is caught", () => {
    // Separate guard exercises failure behavior without triggering the suite's guard.
    const guard = createNetworkGuard();
    expect(() => guard.deny()).toThrow("Unexpected network access blocked by test harness");
    expect(() => guard.assertNoAttempts()).toThrow("Unexpected network access occurred during this test");
  });

  it("does not carry violations between independent guards", () => {
    const first = createNetworkGuard();
    expect(() => first.deny()).toThrow();
    expect(() => createNetworkGuard().assertNoAttempts()).not.toThrow();
  });
});
