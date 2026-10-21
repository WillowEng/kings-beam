import { afterEach, beforeEach, vi } from "vitest";
import { installNetworkGuard, assertNoUnexpectedNetwork } from "./support/network";
import { assertNoSensitiveOutput } from "./support/diagnostics";
import { inspect } from "node:util";

let consoleOutput: string[] = [];

beforeEach(() => {
  installNetworkGuard();
  consoleOutput = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((value) => inspect(value, { depth: null, customInspect: false, getters: false })).join(" "));
    });
  }
});

afterEach(() => {
  try {
    assertNoUnexpectedNetwork();
    assertNoSensitiveOutput(consoleOutput.join("\n"));
  } finally {
    vi.useRealTimers();
  }
});
