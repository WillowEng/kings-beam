import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { vi } from "vitest";

export function createNetworkGuard() {
  let attempts = 0;
  return {
    deny(): never {
      attempts += 1;
      // Never include request arguments: they may contain synthetic secrets.
      throw new Error("Unexpected network access blocked by test harness");
    },
    assertNoAttempts(): void {
      if (attempts !== 0) {
        throw new Error("Unexpected network access occurred during this test");
      }
    },
  };
}

let guard = createNetworkGuard();

export function installNetworkGuard(): void {
  guard = createNetworkGuard();
  vi.stubGlobal("fetch", vi.fn(guard.deny));
  vi.spyOn(http, "request").mockImplementation(guard.deny);
  vi.spyOn(http, "get").mockImplementation(guard.deny);
  vi.spyOn(https, "request").mockImplementation(guard.deny);
  vi.spyOn(https, "get").mockImplementation(guard.deny);
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(guard.deny);
  vi.spyOn(tls, "connect").mockImplementation(guard.deny);
}

export function unexpectedNetwork(): never {
  return guard.deny();
}

export function assertNoUnexpectedNetwork(): void {
  guard.assertNoAttempts();
}
