export type FixtureProvider = "balldontlie" | "odds_api";
export interface ProviderFixture {
  provider: FixtureProvider;
  scenario: string;
  provenance: { kind: "synthetic"; note: string };
  classificationQuery: "regular" | null;
  httpStatus: number;
  headers: Record<string, string>;
  body: unknown;
}

const bdlGame = {
  id: 9900001, season: 2026, date: "2026-10-21", status: "Final", status_state: "final",
  postseason: false, ist_stage: null, datetime: "2026-10-22T02:30:00.000Z",
  home_team: { id: 13, full_name: "LA Clippers" },
  visitor_team: { id: 26, full_name: "Sacramento Kings" },
  home_team_score: 100, visitor_team_score: 110,
};
const oddsGame = {
  id: "synthetic-game-1", sport_key: "basketball_nba", sport_title: "NBA",
  commence_time: "2026-10-22T02:40:00Z", completed: true,
  home_team: "Los Angeles Clippers", away_team: "Sacramento Kings",
  scores: [{ name: "Los Angeles Clippers", score: "100" }, { name: "Sacramento Kings", score: "110" }],
  last_update: "2026-10-22T05:00:00Z",
};

const fixture = (
  provider: FixtureProvider, scenario: string, body: unknown,
  options: Partial<Pick<ProviderFixture, "classificationQuery" | "httpStatus" | "headers">> = {},
): ProviderFixture => ({
  provider, scenario, provenance: { kind: "synthetic", note: "Invented test data; not a real game or verified provider error schema." },
  classificationQuery: provider === "balldontlie" ? "regular" : null,
  httpStatus: 200, headers: {}, body, ...options,
});

const catalog: ProviderFixture[] = [
  fixture("balldontlie", "valid-final", { data: [bdlGame], meta: { per_page: 100 } }),
  fixture("balldontlie", "empty", { data: [], meta: { per_page: 100 } }),
  fixture("balldontlie", "incomplete", { data: [{ id: 9900001, status_state: "final" }] }),
  fixture("balldontlie", "error-envelope-200", { error: "Synthetic API-level error" }),
  fixture("balldontlie", "missing-classification", { data: [bdlGame] }, { classificationQuery: null }),
  fixture("balldontlie", "unauthorized", { error: "Synthetic authentication failure" }, { httpStatus: 401 }),
  fixture("balldontlie", "rate-limited", { error: "Synthetic quota failure" }, { httpStatus: 429, headers: { "Retry-After": "60", "x-ratelimit-remaining": "0" } }),
  fixture("balldontlie", "unavailable", { error: "Synthetic service failure" }, { httpStatus: 503 }),
  fixture("odds_api", "valid-final", [oddsGame], { headers: { "x-requests-used": "2", "x-requests-remaining": "498", "x-requests-last": "2" } }),
  fixture("odds_api", "empty", []),
  fixture("odds_api", "incomplete", [{ ...oddsGame, scores: null }]),
  fixture("odds_api", "error-envelope-200", { error_code: "SYNTHETIC_API_ERROR" }),
  fixture("odds_api", "missing-classification", [oddsGame]),
  fixture("odds_api", "pending", [{ ...oddsGame, completed: false, scores: null, last_update: null }]),
  fixture("odds_api", "unauthorized", { error_code: "SYNTHETIC_AUTH_FAILURE" }, { httpStatus: 401 }),
  fixture("odds_api", "rate-limited", { error_code: "SYNTHETIC_QUOTA_FAILURE" }, { httpStatus: 429, headers: { "Retry-After": "60", "x-requests-remaining": "0" } }),
  fixture("odds_api", "unavailable", { error: "Synthetic service failure" }, { httpStatus: 503 }),
];

for (const score of [-1, 1.5, null, "not-a-score"]) {
  catalog.push(fixture("balldontlie", `malformed-score-${String(score)}`, { data: [{ ...bdlGame, visitor_team_score: score }] }));
}
for (const score of ["-1", "1.5", "NaN", "Infinity", "", null]) {
  catalog.push(fixture("odds_api", `malformed-score-${String(score) || "empty"}`, [{ ...oddsGame, scores: [{ name: "Los Angeles Clippers", score: "100" }, { name: "Sacramento Kings", score }] }]));
}

/** Independent copies prevent one scenario/environment from mutating another. */
export function providerFixtures(): ProviderFixture[] {
  return structuredClone(catalog);
}

export function providerFixture(provider: FixtureProvider, scenario: string): ProviderFixture {
  const result = providerFixtures().find((entry) => entry.provider === provider && entry.scenario === scenario);
  if (!result) throw new Error("Unknown fixture selection");
  return result;
}
