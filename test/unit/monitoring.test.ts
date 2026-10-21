import { describe, expect, it } from "vitest";
import { createMonitoringDouble } from "../support/monitoring";

describe("monitoring delivery double", () => {
  it.each(["heartbeat", "open", "recover", "test-alert"] as const)("captures %s without network or email", async (action) => {
    const monitor = createMonitoringDouble("test");
    await monitor.send(action, 1);
    expect(monitor.delivered).toEqual([{ environment: "test", action, incident: 1 }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("can fail a delivery then accept a retry without recording a false success", async () => {
    const monitor = createMonitoringDouble("test");
    monitor.failNextDelivery();
    await expect(monitor.send("open", 1)).rejects.toThrow("Synthetic notification delivery failure");
    expect(monitor.delivered).toEqual([]);
    await monitor.send("open", 1);
    expect(monitor.delivered).toHaveLength(1);
  });
});
