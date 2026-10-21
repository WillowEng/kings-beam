export const SYNTHETIC_CREDENTIALS = {
  bdl: "synthetic-bdl-secret-DO-NOT-USE",
  odds: "synthetic-odds-secret-DO-NOT-USE",
  monitor: "synthetic-monitor-secret-DO-NOT-USE",
} as const;

export function assertNoSensitiveOutput(output: string): void {
  let decoded = output;
  for (let i = 0; i < 2; i++) {
    try { decoded = decodeURIComponent(decoded); }
    catch { break; }
  }
  if (
    Object.values(SYNTHETIC_CREDENTIALS).some((secret) => decoded.includes(secret)) ||
    /[?&](?:api_?key|token|access_token|secret|password)=/i.test(decoded) ||
    /https:\/\/(?:hc-ping\.com|ping\.healthchecks\.io)\/[^\s"']+/i.test(decoded)
  ) {
    // Never echo the offending output into the test failure.
    throw new Error("Sensitive diagnostic output detected");
  }
}

/** Test-only safe recorder, NOT an implementation of production logging. */
export function createDiagnosticCapture() {
  const entries: Array<{ provider: string; outcome: string; status?: number }> = [];
  return {
    record(input: Record<string, unknown>): void {
      const provider = ["balldontlie", "odds_api", "monitoring"].find((v) => v === input.provider) ?? "unknown";
      const outcome = ["response", "timeout", "network-error", "notification"].find((v) => v === input.outcome) ?? "unknown";
      const status = typeof input.status === "number" && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : undefined;
      entries.push({ provider, outcome, ...(status === undefined ? {} : { status }) });
    },
    serialize(): string { return JSON.stringify(entries); },
  };
}
