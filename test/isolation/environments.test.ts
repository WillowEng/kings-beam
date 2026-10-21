import { describe, expect, it } from "vitest";
import { createMonitoringDouble } from "../support/monitoring";
import { providerFixture } from "../fixtures/providers";
import { createDiagnosticCapture } from "../support/diagnostics";

describe("test-harness environment isolation", () => {
  it("keeps monitoring deliveries separate", async () => {
    const production = createMonitoringDouble("production");
    const test = createMonitoringDouble("test");
    await test.send("test-alert");
    expect(test.delivered).toHaveLength(1);
    expect(production.delivered).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns deep-cloned fixture bodies to each consumer", () => {
    const first = providerFixture("balldontlie", "valid-final");
    (first.body as { data: unknown[] }).data.length = 0;
    const second = providerFixture("balldontlie", "valid-final");
    expect((second.body as { data: unknown[] }).data).toHaveLength(1);
    expect(second.body).not.toBe(first.body);
  });

  it("does not share captured diagnostics", () => {
    const production = createDiagnosticCapture();
    const test = createDiagnosticCapture();
    test.record({ provider: "monitoring", outcome: "notification" });
    expect(production.serialize()).toBe("[]");
    expect(JSON.parse(test.serialize())).toHaveLength(1);
  });
});
