import { describe, expect, it } from "vitest";
import { createDiagnosticCapture, assertNoSensitiveOutput, SYNTHETIC_CREDENTIALS } from "../support/diagnostics";

describe("synthetic credential protection", () => {
  it("captures only allowlisted diagnostics, excluding URLs, headers and error text", () => {
    const capture = createDiagnosticCapture();
    capture.record({
      provider: "odds_api", outcome: "response", status: 200,
      url: `https://provider.invalid/scores?apiKey=${SYNTHETIC_CREDENTIALS.odds}`,
      headers: { Authorization: SYNTHETIC_CREDENTIALS.bdl },
      error: new Error(`Synthetic failure with ${SYNTHETIC_CREDENTIALS.monitor}`),
    });
    const output = capture.serialize();
    expect(JSON.parse(output)).toEqual([{ provider: "odds_api", outcome: "response", status: 200 }]);
    expect(() => assertNoSensitiveOutput(output)).not.toThrow();
    console.info({ diagnostic: output });
    expect(console.info).toHaveBeenCalledWith({ diagnostic: output });
  });

  it("does not trust strings smuggled into allowlisted enum fields", () => {
    const capture = createDiagnosticCapture();
    capture.record({ provider: SYNTHETIC_CREDENTIALS.bdl, outcome: SYNTHETIC_CREDENTIALS.odds, status: SYNTHETIC_CREDENTIALS.monitor });
    expect(capture.serialize()).toBe('[{"provider":"unknown","outcome":"unknown"}]');
    assertNoSensitiveOutput(capture.serialize());
  });

  it.each([
    SYNTHETIC_CREDENTIALS.bdl,
    `https://provider.invalid/scores?apiKey=${SYNTHETIC_CREDENTIALS.odds}`,
    "https://provider.invalid/scores?APIKEY=unlisted-synthetic-value",
    encodeURIComponent(`https://provider.invalid/scores?apiKey=${SYNTHETIC_CREDENTIALS.odds}`),
    encodeURIComponent(encodeURIComponent(SYNTHETIC_CREDENTIALS.monitor)),
    "https://hc-ping.com/synthetic-check-only",
  ])("rejects sensitive captured text without echoing it", (output) => {
    let message = "";
    try { assertNoSensitiveOutput(output); }
    catch (error) { message = (error as Error).message; }
    expect(message).toBe("Sensitive diagnostic output detected");
  });
});
