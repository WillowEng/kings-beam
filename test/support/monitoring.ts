export type TestEnvironment = "production" | "test";
export type MonitorAction = "heartbeat" | "open" | "recover" | "test-alert";

/** In-memory delivery double. No ping URLs, email addresses, or HTTP calls. */
export function createMonitoringDouble(environment: TestEnvironment) {
  const delivered: Array<{ environment: TestEnvironment; action: MonitorAction; incident: number }> = [];
  let failNext = false;
  return {
    delivered,
    failNextDelivery(): void { failNext = true; },
    async send(action: MonitorAction, incident = 0): Promise<void> {
      if (failNext) {
        failNext = false;
        throw new Error("Synthetic notification delivery failure");
      }
      delivered.push({ environment, action, incident });
    },
  };
}
