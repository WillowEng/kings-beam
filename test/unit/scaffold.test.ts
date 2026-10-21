import { afterEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import type { Env } from "../../src/config";

const production: Env = { APP_ENV: "production" };
const test: Env = { APP_ENV: "test" };

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

describe("local Worker scaffold", () => {
  it("returns an explicit unavailable error without fabricated Beam fields", async () => {
    const response = worker.fetch(
      new Request("https://scaffold.invalid/status.json"),
      production,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({
      error: "not_initialized",
      message: "Beam status is not available in this scaffold.",
    });
  });

  it.each(["/status.json", "/admin/test/status.json"])(
    "does not expose TEST status at %s",
    async (path) => {
      const response = worker.fetch(new Request(`https://scaffold.invalid${path}`), test);
      expect(response.status).toBe(404);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect(await response.json()).toEqual({ error: "not_found" });
    },
  );

  it.each(["GET", "POST"])("leaves admin routes inaccessible for %s", (method) => {
    for (const env of [production, test]) {
      for (const path of ["/admin", "/admin/", "/admin/settings"]) {
        const response = worker.fetch(
          new Request(`https://scaffold.invalid${path}`, { method }),
          env,
        );
        expect(response.status).toBe(404);
        expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
      }
    }
  });

  it("does not accept a status mutation or expose unknown routes", () => {
    const mutation = worker.fetch(
      new Request("https://scaffold.invalid/status.json", { method: "POST" }),
      production,
    );
    expect(mutation.status).toBe(404);
    expect(worker.fetch(new Request("https://scaffold.invalid/unknown"), production).status).toBe(404);
  });

  it("has no scheduled handler to run background work", () => {
    expect(worker).not.toHaveProperty("scheduled");
  });
});
