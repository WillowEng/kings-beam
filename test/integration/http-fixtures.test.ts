import { describe, expect, it, vi } from "vitest";
import { providerFixtures } from "../fixtures/providers";
import { observedEvidence } from "../fixtures/observed-evidence";
import { createMockHttp } from "../support/http";
import { SYNTHETIC_CREDENTIALS, assertNoSensitiveOutput } from "../support/diagnostics";

describe("fixture-to-transport integration (no provider adapter)", () => {
  it.each(providerFixtures())("delivers $provider / $scenario with its status and headers", async (fixture) => {
    const mock = createMockHttp([{
      origin: "https://provider.invalid", pathname: "/games",
      outcome: { kind: "json", body: fixture.body, status: fixture.httpStatus, headers: fixture.headers },
    }]);
    vi.stubGlobal("fetch", mock.fetch);
    const response = await fetch(`https://provider.invalid/games?apiKey=${SYNTHETIC_CREDENTIALS.odds}`);
    expect(response.status).toBe(fixture.httpStatus);
    for (const [name, value] of Object.entries(fixture.headers)) expect(response.headers.get(name)).toBe(value);
    expect(await response.json()).toEqual(fixture.body);
    expect(fixture.provenance.kind).toBe("synthetic");
    assertNoSensitiveOutput(JSON.stringify(mock.calls));
    mock.assertConsumed();
  });

  it("keeps reduced observed evidence separate from synthetic responses", () => {
    expect(observedEvidence.provenance.kind).toBe("observed-reconstruction");
    expect(observedEvidence.balldontlie.data[0].visitor_team_score).toBe(116);
    expect(observedEvidence.oddsApi[0].scores[1].score).toBe("116");
    expect(providerFixtures().every((fixture) => fixture.provenance.kind === "synthetic")).toBe(true);
  });
});
