import type { Game, Observation } from "./models";
export function matchGame(observation: Observation, games: Game[], toleranceMinutes = 90): Game | null {
  if (!observation.scheduledStartAt) return null;
  const candidates = games.filter(g => g.home === observation.home && g.away === observation.away &&
    (observation.season === null || observation.season === g.season) && g.scheduledStartAt &&
    Math.abs(Date.parse(g.scheduledStartAt) - Date.parse(observation.scheduledStartAt!)) <= toleranceMinutes * 60_000);
  return candidates.length === 1 ? candidates[0] : null;
}
