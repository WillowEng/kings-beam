import { canonicalName } from "../core/teams";
import { instant } from "../core/time";
import { object, optionalInstant, requestJson, result, score, type AdapterResult, type RequestBudget, type Transport } from "./adapter";
export function parseOddsApi(body: unknown, observedAt: string): AdapterResult {
  const output = result("odds_api"), at = instant(observedAt);
  if (!Array.isArray(body)) { output.errors.push("invalid_response"); return output; }
  for (const raw of body) {
    try {
      const game = object(raw);
      if (typeof game.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(game.id) || game.sport_key !== "basketball_nba" || typeof game.completed !== "boolean") throw new Error("invalid_record");
      const home = canonicalName(game.home_team), away = canonicalName(game.away_team);
      if (!home || !away || home === away) throw new Error("invalid_record");
      let homeScore: number | null = null, awayScore: number | null = null;
      if (game.completed) {
        if (!Array.isArray(game.scores) || game.scores.length !== 2) throw new Error("invalid_record");
        const scores = game.scores.map(s => { const item = object(s); return { team: canonicalName(item.name), score: score(item.score, true) }; });
        if (new Set(scores.map(s => s.team)).size !== 2 || !scores.some(s => s.team === home) || !scores.some(s => s.team === away)) throw new Error("invalid_record");
        homeScore = scores.find(s => s.team === home)!.score; awayScore = scores.find(s => s.team === away)!.score;
        if (homeScore === awayScore) throw new Error("invalid_record");
      }
      output.observations.push({ provider: "odds_api", providerGameId: game.id, home, away, season: null,
        scheduledStartAt: optionalInstant(game.commence_time), observedAt: at,
        lifecycle: game.completed ? "final" : "scheduled", homeScore, awayScore,
        competition: "unknown", classificationProvenance: null });
    } catch { output.errors.push("invalid_record"); }
  }
  return output;
}
export async function fetchOddsApi(options: { transport: Transport; budget: RequestBudget; apiKey: string; observedAt: string; daysFrom?: 1 | 3; timeoutMs?: number }): Promise<AdapterResult> {
  if (!options.apiKey || (options.daysFrom !== undefined && ![1, 3].includes(options.daysFrom))) throw new Error("invalid_request_config");
  const url = new URL("https://api.the-odds-api.com/v4/sports/basketball_nba/scores/");
  url.search = new URLSearchParams({ apiKey: options.apiKey, daysFrom: String(options.daysFrom ?? 3), dateFormat: "iso" }).toString();
  const response = await requestJson("odds_api", url, {}, options.transport, options.budget, options.observedAt, options.timeoutMs);
  if (response.output.errors.length) return response.output;
  return { ...parseOddsApi(response.body, options.observedAt), credits: response.output.credits };
}
