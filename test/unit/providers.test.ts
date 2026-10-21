import { describe, expect, it, vi } from "vitest";
import { parseBalldontlie, fetchBalldontlie } from "../../src/providers/balldontlie";
import { parseOddsApi, fetchOddsApi } from "../../src/providers/oddsApi";
import { providerFixture, providerFixtures } from "../fixtures/providers";
import { observedEvidence } from "../fixtures/observed-evidence";
import { createMockHttp } from "../support/http";
import { assertNoSensitiveOutput, SYNTHETIC_CREDENTIALS } from "../support/diagnostics";
import { freezeUtc } from "../support/time";
import { NOW } from "../support/domain";
import type { RequestBudget } from "../../src/providers/adapter";

const budget = (): RequestBudget => ({ reserve: vi.fn(async () => true), chargeExtra: vi.fn(async () => {}) });
const oddsRoute = { origin: "https://api.the-odds-api.com", pathname: "/v4/sports/basketball_nba/scores/" };
describe("provider runtime validation", () => {
  it.each(providerFixtures())("validates synthetic $provider / $scenario", (fixture) => {
    const parsed = fixture.provider === "balldontlie"
      ? parseBalldontlie(fixture.body, fixture.classificationQuery ? { queryType: fixture.classificationQuery } : {}, NOW)
      : parseOddsApi(fixture.body, NOW);
    const invalid = !["valid-final", "empty", "missing-classification", "pending"].includes(fixture.scenario);
    expect(parsed.errors.length > 0).toBe(invalid);
    if (fixture.scenario === "missing-classification") expect(parsed.observations[0].competition).toBe("unknown");
    assertNoSensitiveOutput(JSON.stringify(parsed));
  });
  it("parses selected prior evidence without fabricating completion times", () => {
    const bdl = parseBalldontlie(observedEvidence.balldontlie, { queryType: "regular" }, NOW);
    const odds = parseOddsApi(observedEvidence.oddsApi, NOW);
    expect(bdl.errors).toEqual([]); expect(odds.errors).toEqual([]);
    expect(bdl.observations[0]).toMatchObject({ home: "SAS", away: "OKC", homeScore: 104, awayScore: 116, competition: "regular" });
    expect(odds.observations[0]).toMatchObject({ home: "SAS", away: "OKC", homeScore: 104, awayScore: 116, competition: "unknown" });
    expect(odds.observations[0]).not.toHaveProperty("actualCompletedAt");
  });
  it("accepts harmless new fields and rejects tied finals or unknown identity", () => {
    const fixture = providerFixture("balldontlie", "valid-final").body as { data: Record<string, unknown>[] };
    fixture.data[0].future_field = true;
    expect(parseBalldontlie(fixture, { queryType: "regular" }, NOW).errors).toEqual([]);
    fixture.data[0].visitor_team_score = 100;
    expect(parseBalldontlie(fixture, { queryType: "regular" }, NOW).errors).toContain("invalid_record");
    fixture.data[0].visitor_team = { id: 26, full_name: "Oklahoma City Thunder" };
    expect(parseBalldontlie(fixture, {}, NOW).observations).toEqual([]);
  });
  it("maps scores by team, not array order", () => {
    const body = providerFixture("odds_api", "valid-final").body as Array<{ scores: unknown[] }>;
    body[0].scores.reverse();
    expect(parseOddsApi(body, NOW).observations[0]).toMatchObject({ home: "LAC", away: "SAC", homeScore: 100, awayScore: 110 });
  });
  it("exposes pagination without claiming a complete scan", () => {
    const body = { ...(providerFixture("balldontlie", "valid-final").body as object), meta: { next_cursor: 42 } };
    expect(parseBalldontlie(body, { queryType: "regular" }, NOW).nextCursor).toBe("42");
  });
});

describe("bounded injected provider requests", () => {
  it("uses BDL authorization and explicit classification query", async () => {
    const fixture = providerFixture("balldontlie", "valid-final");
    const mock = createMockHttp([{ origin: "https://api.balldontlie.io", pathname: "/v1/games", outcome: { kind: "json", body: fixture.body } }]);
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("Authorization") === SYNTHETIC_CREDENTIALS.bdl).toBe(true);
      expect(new URL(request.url).searchParams.get("season_type")).toBe("regular");
      return mock.fetch(input, init);
    };
    const result = await fetchBalldontlie({ transport, budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.bdl, observedAt: NOW, context: { queryType: "regular" }, dates: { start: "2026-10-21", end: "2026-10-21" }, teamId: 26 });
    expect(result.observations).toHaveLength(1); mock.assertConsumed();
  });
  it("uses the scores endpoint only and records extra actual credit cost", async () => {
    const b = budget();
    const mock = createMockHttp([{ ...oddsRoute, outcome: { kind: "json", body: providerFixture("odds_api", "valid-final").body, headers: { "x-requests-last": "3" } } }]);
    const result = await fetchOddsApi({ transport: mock.fetch, budget: b, apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.credits).toBe(3);
    expect(b.chargeExtra).toHaveBeenCalledWith("odds_api", 1);
    assertNoSensitiveOutput(JSON.stringify(result)); mock.assertConsumed();
  });
  it("makes no request when the reserved budget is exhausted", async () => {
    const b = budget(); b.reserve = async () => false;
    const result = await fetchOddsApi({ transport: async () => { throw new Error("must not run"); }, budget: b, apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.errors).toEqual(["budget_exhausted"]);
  });
  it("reports rate limits and retry delay without upstream error contents", async () => {
    const mock = createMockHttp([{ ...oddsRoute, outcome: { kind: "json", status: 429, body: { url: `https://provider.invalid?apiKey=${SYNTHETIC_CREDENTIALS.odds}` }, headers: { "Retry-After": "60" } } }]);
    const result = await fetchOddsApi({ transport: mock.fetch, budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.errors).toEqual(["rate_limited"]); expect(result.retryAfterSeconds).toBe(60);
    assertNoSensitiveOutput(JSON.stringify(result));
  });
  it("bounds timeout and never echoes secret-bearing thrown errors", async () => {
    freezeUtc(NOW);
    const mock = createMockHttp([{ ...oddsRoute, outcome: { kind: "timeout" } }]);
    const pending = fetchOddsApi({ transport: mock.fetch, budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).errors).toEqual(["timeout"]);
    const result = await fetchOddsApi({ transport: async () => { throw new Error(`https://provider.invalid?apiKey=${SYNTHETIC_CREDENTIALS.odds}`); }, budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.errors).toEqual(["network_error"]); assertNoSensitiveOutput(JSON.stringify(result));
  });
  it.each(["not json", "x".repeat(2_000_001)])("rejects malformed or oversized response bodies", async (body) => {
    const result = await fetchOddsApi({ transport: async () => new Response(body), budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.errors).toEqual(["invalid_response"]);
  });
  it("honors HTTP-date Retry-After without exposing headers", async () => {
    const result = await fetchOddsApi({ transport: async () => new Response("", { status: 429, headers: { "Retry-After": "Thu, 22 Oct 2026 05:01:00 GMT" } }), budget: budget(), apiKey: SYNTHETIC_CREDENTIALS.odds, observedAt: NOW });
    expect(result.retryAfterSeconds).toBe(60);
  });
  it("rejects missing lifecycle, unsupported schema states, and contradictory postponement", () => {
    for (const patch of [{ status_state: undefined }, { status_state: "brand_new_state" }, { postponed: true }]) {
      const body = providerFixture("balldontlie", "valid-final").body as { data: object[] };
      Object.assign(body.data[0], patch);
      expect(parseBalldontlie(body, { queryType: "regular" }, NOW).errors).toContain("invalid_record");
    }
  });
});
