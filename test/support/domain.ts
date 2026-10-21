import { CATEGORIES, defaultSettings, type Game, type Observation, type Snapshot } from "../../src/core/models";
export const NOW = "2026-10-22T05:00:00.000Z";
export function observation(patch: Partial<Observation> = {}): Observation {
  return { provider: "balldontlie", providerGameId: "9900001", home: "LAC", away: "SAC", season: 2026,
    scheduledStartAt: "2026-10-22T02:30:00.000Z", observedAt: NOW, lifecycle: "final",
    homeScore: 100, awayScore: 110, competition: "regular", classificationProvenance: "bdl:regular", ...patch };
}
export function odds(patch: Partial<Observation> = {}): Observation {
  return observation({ provider: "odds_api", providerGameId: "synthetic-odds-1", season: null,
    competition: "unknown", classificationProvenance: null, scheduledStartAt: "2026-10-22T02:40:00.000Z", ...patch });
}
export function game(observations: Observation[] = [observation()], patch: Partial<Game> = {}): Game {
  return { id: "bdl:9900001", revision: 0, home: "LAC", away: "SAC", season: 2026, scheduledStartAt: "2026-10-22T02:30:00.000Z", actualCompletedAt: null, observations, ...patch };
}
export function snapshot(games: Game[] = [game()], patch: Partial<Snapshot> = {}): Snapshot {
  return { team: "SAC", settings: defaultSettings(), games,
    coverage: [{ day: "2026-10-21", categories: [...CATEGORIES], sources: ["balldontlie", "odds_api"], complete: true, checkedAt: NOW, validUntil: "2026-10-22T05:15:00.000Z" }],
    override: null, failedSources: [], checkedAt: NOW, ...patch };
}
