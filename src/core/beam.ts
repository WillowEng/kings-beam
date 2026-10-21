import { CATEGORIES, type PublicStatus, type Snapshot } from "./models";
import { reconcile } from "./reconcile";
import { instant, pacificDate } from "./time";
export function calculateStatus(snapshot: Snapshot, at: string): PublicStatus {
  const now = instant(at), today = pacificDate(now);
  const settings = snapshot.settings;
  const decisions = snapshot.games.filter(game => game.home === snapshot.team || game.away === snapshot.team).map(game => reconcile({ ...game, observations: game.observations.filter(o => o.observedAt <= now) }, settings));
  const eligible = decisions.filter(d => d.competition !== "unknown" && settings.eligibility[d.competition]);
  const wins = eligible.filter(d => d.final && (d.game.home === snapshot.team ? d.final.homeScore! > d.final.awayScore! : d.final.awayScore! > d.final.homeScore!));
  const dated = wins.filter(d => d.day && d.day <= today).sort((a, b) => b.day!.localeCompare(a.day!));
  const latest = dated[0];
  const uncertainNewerWin = wins.some(d => !d.day && (!latest || !d.game.scheduledStartAt || pacificDate(d.game.scheduledStartAt) >= latest.day!));
  const pendingCouldBeNewer = latest?.day !== today && decisions.some(d => {
    if (d.final || (d.competition !== "unknown" && !settings.eligibility[d.competition])) return false;
    if (d.game.scheduledStartAt && d.game.scheduledStartAt > now) return false;
    if (d.game.observations.length && d.game.observations.every(o => ["canceled", "postponed"].includes(o.lifecycle))) return false;
    return !d.firstFinalAt || !latest || pacificDate(d.firstFinalAt) > latest.day!;
  });
  const gapCouldBeNewer = latest && snapshot.historyGaps?.some(g => g.start <= today && g.end > latest.day!);
  const lastWin = uncertainNewerWin || pendingCouldBeNewer || gapCouldBeNewer ? null : latest?.day ?? null;
  const support = wins.filter(d => d.day === today && (!settings.requireDualAgreementForOn || d.dual));
  const chosen = support.find(d => d.dual) ?? support[0];
  const coverage = snapshot.coverage.some(c => c.day === today && c.complete && c.checkedAt <= now && c.validUntil > now &&
    c.sources.includes("balldontlie") && c.sources.includes("odds_api") && CATEGORIES.every(k => !settings.eligibility[k] || c.categories.includes(k)));
  const relevant = decisions.filter(d => {
    if (d.competition !== "unknown" && !settings.eligibility[d.competition]) return false;
    if (d.day) return d.day === today;
    // An unfinished old game is a recovery gap until canceled or otherwise resolved.
    const start = d.game.scheduledStartAt;
    if (!start) return true;
    if (start > now) return false;
    const terminal = d.game.observations.length > 0 && d.game.observations.every(o => ["canceled", "postponed"].includes(o.lifecycle));
    return !terminal && (!d.firstFinalAt || pacificDate(d.firstFinalAt) >= today);
  });
  const unsettled = relevant.some(d => d.disputed || d.competition === "unknown" || !d.final || !d.day || !d.dual);
  const currentHistoryGap = snapshot.historyGaps?.some(g => g.start <= today && g.end >= today) ?? false;
  const enabledBoth = settings.enabled.balldontlie && settings.enabled.odds_api;
  const checked = snapshot.checkedAt && snapshot.checkedAt <= now ? snapshot.checkedAt : null;
  const fallback = eligible.find(d => d.final && relevant.some(r => r.game.id === d.game.id));
  const base: PublicStatus = {
    beam_on: Boolean(chosen), verified: enabledBoth && coverage && !currentHistoryGap && !unsettled && !snapshot.unmatchedRelevant && !snapshot.failedSources.some(p => settings.enabled[p]),
    last_win: lastWin, mode: "auto", source: chosen?.source ?? (fallback?.source ?? "none"), checked_at: checked,
  };
  const override = snapshot.override;
  const active = override && override.mode !== "AUTO" && override.createdAt <= now && override.expiresAt && override.expiresAt > now;
  if (active) return { ...base, beam_on: override.mode === "FORCE_ON", verified: false, mode: settings.manualOnly ? "manual_only" : override.mode === "FORCE_ON" ? "manual_on" : "manual_off", source: "manual" };
  if (settings.manualOnly) return { ...base, beam_on: false, verified: false, mode: "manual_only", source: "manual" };
  return base;
}
