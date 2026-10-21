import { beforeEach, vi } from "vitest";

// No real HTTP fetch is permitted in scaffold tests. Provider adapters do not exist.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network fetch is forbidden in local scaffold tests");
    }),
  );
});
