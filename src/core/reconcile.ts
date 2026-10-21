import type { Game, Observation, Provider, Settings, Competition } from "./models";
import { completionDay } from "./time";
export interface Decision {
  game: Game; competition: Competition; disputed: boolean; final: Observation | null;
  dual: boolean; source: Provider | "dual" | "none"; day: string | null;
  firstFinalAt: string | null; lastNonfinalAt: string | null;
}
export function reconcile(game: Game, settings: Settings): Decision {
  const sorted = [...game.observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const latest = new Map<Provider, Observation>();
  const simultaneousConflicts = new Set<Provider>();
  for (const o of sorted) {
    const prior = latest.get(o.provider);
    if (prior && prior.observedAt < o.observedAt) simultaneousConflicts.delete(o.provider);
    if (prior && prior.observedAt === o.observedAt && prior.lifecycle === "final" && o.lifecycle === "final" &&
      (prior.homeScore !== o.homeScore || prior.awayScore !== o.awayScore)) simultaneousConflicts.add(o.provider);
    latest.set(o.provider, o);
  }
  let disputed = simultaneousConflicts.size > 0;
  const classes = new Set(sorted.filter(o => o.competition !== "unknown").map(o => o.competition));
  if (classes.size > 1) disputed = true;
  const competition = classes.size === 1 ? [...classes][0] : "unknown";
  const finals = [...latest.values()].filter(o => o.lifecycle === "final");
  if (finals.length === 2 && (finals[0].homeScore !== finals[1].homeScore || finals[0].awayScore !== finals[1].awayScore)) disputed = true;
  const dual = finals.length === 2 && !disputed;
  // Retain uncontested stored evidence even if a source is subsequently disabled.
  const final = disputed ? null : settings.priority.map(p => finals.find(o => o.provider === p)).find(Boolean) ?? null;
  const firstFinalAt = sorted.find(o => o.lifecycle === "final")?.observedAt ?? null;
  const lastNonfinalAt = sorted.filter(o => o.lifecycle !== "final" && (!firstFinalAt || o.observedAt < firstFinalAt)).at(-1)?.observedAt ?? null;
  return { game, competition, disputed, final, dual, source: dual ? "dual" : final?.provider ?? "none",
    day: completionDay(game.scheduledStartAt, firstFinalAt, game.actualCompletedAt), firstFinalAt, lastNonfinalAt };
}
