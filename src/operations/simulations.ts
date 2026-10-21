import { calculateStatus } from "../core/beam";
import { CATEGORIES, defaultSettings, type Observation, type Snapshot } from "../core/models";
/** Pure, synthetic TEST-only scenarios. No database, transport, credentials or runtime bindings. */
export function simulations() {
  const at = "2026-10-22T05:00:00.000Z";
  const bdl: Observation = { provider: "balldontlie", providerGameId: "synthetic-game", home: "SAC", away: "OKC", season: 2026, scheduledStartAt: "2026-10-22T02:00:00.000Z", observedAt: at, lifecycle: "final", homeScore: 110, awayScore: 100, competition: "regular", classificationProvenance: "bdl:regular" };
  const odds: Observation = { ...bdl, provider: "odds_api", providerGameId: "synthetic-secondary", season: null, competition: "unknown", classificationProvenance: null };
  const base = (): Snapshot => ({ team: "SAC", settings: defaultSettings(), games: [{ id: "synthetic-canonical", revision: 0, home: "SAC", away: "OKC", season: 2026, scheduledStartAt: bdl.scheduledStartAt, actualCompletedAt: null, observations: [{ ...bdl }, { ...odds }] }], coverage: [{ day: "2026-10-21", categories: [...CATEGORIES], sources: ["balldontlie", "odds_api"], complete: true, checkedAt: at, validUntil: "2026-10-22T05:15:00.000Z" }], override: null, failedSources: [], checkedAt: at });
  const scenarios: Array<{ name: string; input: Snapshot; at: string; expected: { beam_on: boolean; verified: boolean } }> = [];
  for (const category of CATEGORIES) {
    const input = base(); input.games[0].observations[0].competition = category;
    scenarios.push({ name: `${category}: synthetic victory with defaults`, input, at, expected: { beam_on: category !== "summer_league", verified: true } });
  }
  const provisional = base(); provisional.games[0].observations.pop(); scenarios.push({ name: "single-source provisional", input: provisional, at, expected: { beam_on: true, verified: false } });
  const conflict = base(); conflict.games[0].observations[1].awayScore = 120; scenarios.push({ name: "late contradiction withdraws support", input: conflict, at, expected: { beam_on: false, verified: false } });
  const manual = structuredClone(conflict); manual.override = { mode: "FORCE_ON", createdAt: at, expiresAt: "2026-10-22T07:00:00.000Z" }; scenarios.push({ name: "manual override defeats conflict", input: manual, at, expected: { beam_on: true, verified: false } });
  scenarios.push({ name: "midnight expires win and freshness without Cron", input: base(), at: "2026-10-22T07:00:00.000Z", expected: { beam_on: false, verified: false } });
  return { label: "SYNTHETIC TEST — DOES NOT AFFECT KINGS", scenarios: scenarios.map(s => { const actual = calculateStatus(s.input, s.at); return { ...s, actual, result: actual.beam_on === s.expected.beam_on && actual.verified === s.expected.verified ? "PASS" : "FAIL" }; }) };
}
