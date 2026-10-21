import { classify, type ClassificationContext } from "../core/eligibility";
import type { Lifecycle, Observation } from "../core/models";
import { canonicalBdl } from "../core/teams";
import { instant } from "../core/time";
import { object, optionalInstant, requestJson, result, score, type AdapterResult, type RequestBudget, type Transport } from "./adapter";

export function parseBalldontlie(body: unknown, context: ClassificationContext, observedAt: string): AdapterResult {
  const output = result("balldontlie"), at = instant(observedAt);
  try {
    const envelope = object(body);
    if (!Array.isArray(envelope.data) || envelope.error || envelope.errors) throw new Error("invalid_response");
    if (envelope.meta != null) {
      const meta = object(envelope.meta);
      if (meta.next_cursor != null) {
        if (!(typeof meta.next_cursor === "number" && Number.isSafeInteger(meta.next_cursor) && meta.next_cursor >= 0)) throw new Error("invalid_response");
        output.nextCursor = String(meta.next_cursor);
      }
    }
    for (const raw of envelope.data) {
      try {
        const game = object(raw);
        if (!Number.isSafeInteger(game.id) || Number(game.id) <= 0 || !Number.isInteger(game.season) || Number(game.season) < 1946 || Number(game.season) > 2200) throw new Error("invalid_record");
        const home = canonicalBdl(object(game.home_team)), away = canonicalBdl(object(game.visitor_team));
        if (!home || !away || home === away) throw new Error("invalid_record");
        const states: Record<string, Lifecycle> = { scheduled: "scheduled", in_progress: "in_progress", final: "final", postponed: "postponed", delayed: "other", suspended: "other", canceled: "canceled", abandoned: "other", unknown: "unknown" };
        if (typeof game.status_state !== "string" || !Object.hasOwn(states, game.status_state)) throw new Error("invalid_record");
        const lifecycle = typeof game.status_state === "string" ? states[game.status_state] ?? "unknown" : "unknown";
        const final = lifecycle === "final";
        if (final && game.postponed === true) throw new Error("invalid_record");
        const homeScore = final ? score(game.home_team_score) : null, awayScore = final ? score(game.visitor_team_score) : null;
        if (final && homeScore === awayScore) throw new Error("invalid_record");
        const providerGameId = String(game.id);
        const observation: Observation = {
          provider: "balldontlie", providerGameId, home, away, season: Number(game.season),
          scheduledStartAt: optionalInstant(game.datetime), observedAt: at, lifecycle, homeScore, awayScore,
          ...classify(providerGameId, game, context),
        };
        output.observations.push(observation);
      } catch { output.errors.push("invalid_record"); }
    }
  } catch { output.errors.push("invalid_response"); }
  return output;
}
export async function fetchBalldontlie(options: {
  transport: Transport; budget: RequestBudget; apiKey: string; observedAt: string;
  context: ClassificationContext; dates: { start: string; end: string }; teamId: number;
  cursor?: string; timeoutMs?: number;
}): Promise<AdapterResult> {
  const { context, dates } = options;
  if (!context.queryType || !/^\d{4}-\d\d-\d\d$/.test(dates.start) || !/^\d{4}-\d\d-\d\d$/.test(dates.end) || dates.start > dates.end || !Number.isInteger(options.teamId) || !options.apiKey) throw new Error("invalid_request_config");
  const url = new URL("https://api.balldontlie.io/v1/games");
  url.search = new URLSearchParams({ "team_ids[]": String(options.teamId), start_date: dates.start, end_date: dates.end, season_type: context.queryType, per_page: "100", ...(options.cursor ? { cursor: options.cursor } : {}) }).toString();
  const response = await requestJson("balldontlie", url, { Authorization: options.apiKey }, options.transport, options.budget, options.observedAt, options.timeoutMs);
  if (response.output.errors.length) return response.output;
  return { ...parseBalldontlie(response.body, context, options.observedAt), retryAfterSeconds: response.output.retryAfterSeconds };
}
