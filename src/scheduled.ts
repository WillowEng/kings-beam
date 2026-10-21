import { operationBudget, withEmergency } from "./operations/quota";
import { Store } from "./data/db";
import { Operations, later, shiftDay, QUERY_TYPES, type Scan } from "./operations/store";
import { pacificDate } from "./core/time";
import { reconcile } from "./core/reconcile";
import { TEAMS } from "./core/teams";
import { fetchBalldontlie } from "./providers/balldontlie";
import { fetchOddsApi } from "./providers/oddsApi";
import { type AdapterResult, type Transport } from "./providers/adapter";
import type { Provider } from "./core/models";

export interface RunOptions { at: string; transport: Transport; keys: { balldontlie: string; odds_api: string }; provider?: Provider; diagnostic?: boolean }
export interface RunReport { outcome: "complete" | "busy" | "paused"; checks: Array<{ provider: Provider; outcome: string }>; recoveryPending?: boolean }
/** Only called behind the operational gate or verified owner route. Never runs on a public read. */
export async function runOperations(store: Store, options: RunOptions): Promise<RunReport> {
  const ops = new Operations(store), at = options.at, today = pacificDate(at), startedAt = Date.now();
  const token = await ops.lease("pipeline", at);
  if (!token) return { outcome: "busy", checks: [] };
  const report: RunReport = { outcome: "complete", checks: [] };
  try {
    const config = (await ops.settings()).value;
    const settings = (await store.settings()).value;
    if (store.scope === "test" && !config.liveTest && !options.diagnostic) return { outcome: "paused", checks: [] };
    const health = await ops.stmt("SELECT last_completed FROM runtime_health WHERE id=1").first<{ last_completed: string | null }>();
    await ops.stmt("INSERT INTO runtime_health(id,last_started) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_started=excluded.last_started", at).run();
    // No assumed billing reset: Odds reservations require an explicitly configured evidence-based period.
    const minute = new Date(Math.floor(Date.parse(at) / 60_000) * 60_000).toISOString();
    await store.configureQuota("balldontlie", minute, later(minute, 60_000), store.scope === "production" ? 3 : 1);
    if (config.seasonActive || options.diagnostic) {
      await ops.enqueue(shiftDay(today, -1), shiftDay(today, 1), at);
    }
    // On installation the owner chooses the known history boundary; absent evidence remains explicit.
    const recovery = await ops.stmt("SELECT next_day,through_day FROM recovery_checkpoints WHERE id=1").first<{ next_day: string; through_day: string }>();
    if (!recovery && (health?.last_completed || config.historyStart)) {
      const start = [health?.last_completed ? pacificDate(health.last_completed) : null, config.historyStart].filter((v): v is string => v !== null).sort()[0];
      if (start < today) await ops.stmt("INSERT OR IGNORE INTO recovery_checkpoints(id,next_day,through_day,updated_at) VALUES(1,?,?,?)", start, shiftDay(today, -1), at).run();
    }
    if (recovery && health?.last_completed && pacificDate(health.last_completed) < today) {
      const start = pacificDate(health.last_completed), end = shiftDay(today, -1);
      await ops.stmt("UPDATE recovery_checkpoints SET next_day=CASE WHEN next_day>through_day THEN ? ELSE MIN(next_day,?) END,through_day=MAX(through_day,?),updated_at=? WHERE id=1", start, start, end, at).run();
    }
    const point = await ops.stmt("SELECT next_day,through_day FROM recovery_checkpoints WHERE id=1").first<{ next_day: string; through_day: string }>();
    if (point && point.next_day <= point.through_day) {
      // Bounded seven-day work units, all five classification queries and every page before advancing.
      const end = [shiftDay(point.next_day, 6), point.through_day].sort()[0];
      await ops.enqueue(point.next_day, end, at);
      // Give the expiring secondary window priority over a potentially large historical backlog.
      const recentStart = [point.next_day, shiftDay(today, -3)].sort().at(-1)!;
      if (recentStart <= shiftDay(today, -1)) await ops.enqueue(recentStart, shiftDay(today, -1), at);
      report.recoveryPending = true;
      await store.incident("recovery:pending", "recovery", null, true, at);
      if (point.next_day < shiftDay(today, -3)) await store.incident("recovery:odds_history", "history_gap", null, true, at);
    }
    const snap = await store.snapshot(at);
    const decisions = snap.games.filter(g => g.home === snap.team || g.away === snap.team).map(g => reconcile(g, settings));
    const active = decisions.filter(d => d.game.scheduledStartAt && d.game.scheduledStartAt <= later(at, -90 * 60_000) && !d.game.observations.some(o => o.provider === "balldontlie" && o.lifecycle === "final") && !d.dual && !d.disputed && !["canceled", "postponed"].includes(d.game.observations.at(-1)?.lifecycle ?? ""));
    // Previously completed schedule scans are reopened only for due unresolved games, never every no-game tick.
    if (active.length && settings.enabled.balldontlie) {
      const due = await ops.stmt("SELECT primary_at FROM game_checks WHERE game_id=?", active[0].game.id).first<{ primary_at: string | null }>();
      const age = Date.parse(at) - Date.parse(active[0].game.scheduledStartAt!);
      const interval = age < 150 * 60_000 ? 30 * 60_000 : 5 * 60_000;
      if (!due?.primary_at || due.primary_at <= later(at, -interval)) {
        const provenance = active[0].game.observations.find(o => o.provider === "balldontlie" && o.classificationProvenance?.startsWith("bdl:"))?.classificationProvenance?.slice(4);
        if (provenance && QUERY_TYPES.includes(provenance as import("./core/eligibility").QueryType)) {
          await ops.stmt("UPDATE schedule_sync SET completed_at=NULL,cursor=NULL,next_at=? WHERE start_day=? AND end_day=? AND query_type=? AND completed_at IS NOT NULL AND id NOT LIKE 'diagnostic:%'", at, shiftDay(today, -1), shiftDay(today, 1), provenance).run();
        } else {
          await ops.stmt("UPDATE schedule_sync SET completed_at=NULL,cursor=NULL,next_at=? WHERE start_day=? AND end_day=? AND completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM schedule_sync WHERE start_day=? AND end_day=? AND completed_at IS NULL)", at, shiftDay(today, -1), shiftDay(today, 1), shiftDay(today, -1), shiftDay(today, 1)).run();
        }
      }
    }
    if ((!options.provider || options.provider === "balldontlie") && settings.enabled.balldontlie && await ops.ready("balldontlie", at)) {
      // Max three production requests / one TEST request per invocation; budget also enforces rolling minute.
      if (options.diagnostic) await ops.stmt("INSERT INTO schedule_sync(id,query_type,start_day,end_day,next_at) VALUES(?,'regular',?,?,?)", `diagnostic:${at}`, shiftDay(today, -1), shiftDay(today, 1), at).run();
      for (let i = 0; i < (options.diagnostic ? 1 : store.scope === "production" ? 3 : 1); i++) {
        const scan = options.diagnostic ? await ops.stmt("SELECT * FROM schedule_sync WHERE id=?", `diagnostic:${at}`).first<Scan>() : await ops.dueScan(at);
        if (!scan) break;
        if (!options.keys.balldontlie) { report.checks.push({ provider: "balldontlie", outcome: "not_configured" }); break; }
        const started = Date.now();
        const output = await fetchBalldontlie({ transport: options.transport, budget: operationBudget(ops, at, options.diagnostic ? "diagnostics" : report.recoveryPending ? "recovery" : "normal"), apiKey: options.keys.balldontlie, observedAt: at,
          teamId: TEAMS.find(t => t.id === snap.team)!.bdlId, dates: { start: scan.start_day, end: scan.end_day }, context: { queryType: scan.query_type }, ...(scan.cursor ? { cursor: scan.cursor } : {}) });
        await ops.assertLease("pipeline", token, later(at, Date.now() - startedAt));
        await apply(output, scan, started);
        if (output.errors.length) break;
      }
    } else if (options.provider === "balldontlie") report.checks.push({ provider: "balldontlie", outcome: settings.enabled.balldontlie ? "backoff_or_quota" : "disabled" });
    const current = await store.snapshot(at);
    let oddsDue = options.diagnostic === true, currentDue = false, provisionalWin = false;
    for (const game of current.games.filter(g => g.home === current.team || g.away === current.team)) {
      const d = reconcile(game, settings);
      if (d.dual && !d.disputed || !game.scheduledStartAt || (!d.final && game.scheduledStartAt > later(at, -150 * 60_000))) continue;
      if (game.scheduledStartAt < later(at, -3 * 86_400_000)) continue;
      if (d.final && d.competition !== "unknown" && !settings.eligibility[d.competition]) continue;
      const record = await ops.stmt("SELECT * FROM game_checks WHERE game_id=?", game.id).first<{ secondary_at: string | null; secondary_attempts: number; first_final_at: string | null }>();
      const first = d.firstFinalAt ?? record?.first_final_at ?? later(game.scheduledStartAt, 150 * 60_000);
      const attempt = d.firstFinalAt && !record?.first_final_at ? 0 : record?.secondary_attempts ?? 0;
      const delay = [0, 15, 45, 120][attempt];
      if (delay !== undefined && at >= later(first, delay * 60_000)) {
        oddsDue = true;
        if (d.day === today || pacificDate(game.scheduledStartAt) === today) currentDue = true;
        if (d.day === today && d.final && d.competition !== "unknown" && settings.eligibility[d.competition] && !d.disputed && (game.home === current.team ? d.final.homeScore! > d.final.awayScore! : d.final.awayScore! > d.final.homeScore!)) provisionalWin = true;
      }
      if (at > later(first, 120 * 60_000) && !d.dual) await store.incident(`unverified:${game.id}`, "unverified_final", game.id, true, at);
    }
    if ((!options.provider || options.provider === "odds_api") && settings.enabled.odds_api && oddsDue) {
      if (!await ops.ready("odds_api", at)) report.checks.push({ provider: "odds_api", outcome: "backoff_or_quota" });
      else if (!options.keys.odds_api) report.checks.push({ provider: "odds_api", outcome: "not_configured" });
      else {
        const started = Date.now();
        const output = await fetchOddsApi({ transport: options.transport, budget: withEmergency(operationBudget(ops, at, options.diagnostic ? "diagnostics" : report.recoveryPending && !currentDue ? "recovery" : "normal"), ops, at, !options.diagnostic && provisionalWin), apiKey: options.keys.odds_api, observedAt: at, daysFrom: 3 });
        await ops.assertLease("pipeline", token, later(at, Date.now() - startedAt));
        await apply(output, null, started);
        // One batched request, not one request per game. Never mark quota skips as attempts.
        if (!output.errors.includes("budget_exhausted")) for (const g of current.games.filter(g => (g.home === current.team || g.away === current.team) && g.scheduledStartAt && g.scheduledStartAt <= at && g.scheduledStartAt >= later(at, -3 * 86_400_000))) {
          const d = reconcile(g, settings);
          await ops.stmt("INSERT INTO game_checks(game_id,secondary_at,secondary_attempts,first_final_at) VALUES(?,?,1,?) ON CONFLICT(game_id) DO UPDATE SET secondary_at=excluded.secondary_at,secondary_attempts=CASE WHEN game_checks.first_final_at IS NULL AND excluded.first_final_at IS NOT NULL THEN 1 ELSE secondary_attempts+1 END,first_final_at=COALESCE(game_checks.first_final_at,excluded.first_final_at)", g.id, at, d.firstFinalAt).run();
          const updated = (await store.snapshot(at)).games.find(x => x.id === g.id)!;
          await store.incident(`unverified:${g.id}`, "unverified_final", g.id, !reconcile(updated, settings).dual && at > later(d.firstFinalAt ?? at, 120 * 60_000), at);
        }
      }
    }
    // Complete a recovery interval only after every query and page succeeds. Never turn an error into an empty schedule.
    if (point && point.next_day <= point.through_day) {
      const end = [shiftDay(point.next_day, 6), point.through_day].sort()[0];
      const rows = await ops.stmt("SELECT query_type FROM schedule_sync WHERE start_day=? AND end_day=? AND completed_at IS NOT NULL", point.next_day, end).all<{ query_type: string }>();
      if (new Set(rows.results.map(r => r.query_type)).size === QUERY_TYPES.length) await ops.stmt("UPDATE recovery_checkpoints SET next_day=?,updated_at=? WHERE id=1 AND next_day=?", shiftDay(end, 1), at, point.next_day).run();
    }
    const remaining = await ops.stmt("SELECT next_day FROM recovery_checkpoints WHERE id=1 AND next_day<=through_day").first();
    await store.incident("recovery:pending", "recovery", null, Boolean(remaining), at);
    if (!health?.last_completed && !config.historyStart) await store.incident("recovery:initial_history", "history_gap", null, true, at);
    // Primary query provenance covers six categories. Any unmatched/single-source current game still blocks dual confidence in core; Summer League has no supported query.
    const scans = await ops.stmt("SELECT query_type,completed_at FROM schedule_sync WHERE start_day=? AND end_day=? AND completed_at IS NOT NULL AND id NOT LIKE 'diagnostic:%' ", shiftDay(today, -1), shiftDay(today, 1)).all<{ query_type: string; completed_at: string }>();
    const secondary = await ops.stmt("SELECT succeeded_at FROM provider_health WHERE provider='odds_api'").first<{ succeeded_at: string | null }>();
    const primaryComplete = QUERY_TYPES.every(t => scans.results.some(s => s.query_type === t));
    const primaryFresh = primaryComplete && scans.results.every(s => s.completed_at >= later(at, -15 * 60_000));
    const supported = ["regular", "playoffs", "playin", "cup_regular", "cup_championship", "preseason"] as const;
    if (primaryComplete) {
      const coverageAt = [...scans.results.map(s => s.completed_at), ...(secondary?.succeeded_at ? [secondary.succeeded_at] : [])].sort()[0];
      await store.recordCoverage({ day: today, categories: [...supported], sources: secondary?.succeeded_at && secondary.succeeded_at >= later(at, -15 * 60_000) ? ["balldontlie", "odds_api"] : ["balldontlie"], complete: primaryFresh && config.historyStart !== null, checkedAt: coverageAt, validUntil: later(coverageAt, 15 * 60_000) });
    }
    for (const provider of ["balldontlie", "odds_api"] as const) {
      await store.incident(`configuration:${provider}`, "configuration", null, report.checks.some(c => c.provider === provider && c.outcome === "not_configured"), at);
    }
    if (config.historyStart && !remaining) await store.incident("recovery:initial_history", "history_gap", null, false, at);
    await store.incident("runtime:bookkeeping", "database", null, false, at);
    await ops.cleanup(at);
    await ops.stmt("UPDATE runtime_health SET last_completed=?,last_outcome='complete' WHERE id=1", at).run();
    return report;
    async function apply(output: AdapterResult, scan: Scan | null, started: number) {
      if (output.errors.includes("budget_exhausted")) {
        await store.incident(`quota:${output.provider}`, "quota", null, true, at);
        report.checks.push({ provider: output.provider, outcome: "budget_exhausted" });
        return;
      }
      await store.applyResult(output, at);
      await ops.health(output, at, Date.now() - started);
      await store.incident(`quota:${output.provider}`, "quota", null, false, at);
      if (scan) {
        await ops.saveScan(scan, output, at);
        for (const o of output.observations) {
          const id = await ops.stmt("SELECT game_id FROM provider_game_ids WHERE provider=? AND provider_id=?", o.provider, o.providerGameId).first<{ game_id: string }>();
          if (id) {
            const existing = await ops.stmt("SELECT primary_final_at FROM game_checks WHERE game_id=?", id.game_id).first<{ primary_final_at: string | null }>();
            await ops.stmt("INSERT INTO game_checks(game_id,primary_at,primary_final_at) VALUES(?,?,?) ON CONFLICT(game_id) DO UPDATE SET primary_at=excluded.primary_at,primary_final_at=COALESCE(game_checks.primary_final_at,excluded.primary_final_at)", id.game_id, at, o.lifecycle === "final" ? at : null).run();
            // Refresh other classifications once after first primary final, so old daily scans cannot
            // either certify freshness or permanently prevent a freshly reconciled game being verified.
            if (o.lifecycle === "final" && !existing?.primary_final_at) await ops.stmt("UPDATE schedule_sync SET completed_at=NULL,cursor=NULL,next_at=? WHERE start_day=? AND end_day=? AND query_type<>? AND completed_at IS NOT NULL AND id NOT LIKE 'diagnostic:%'", at, shiftDay(today, -1), shiftDay(today, 1), scan.query_type).run();
          }
        }
      }
      report.checks.push({ provider: output.provider, outcome: output.errors[0] ?? (scan?.cursor || output.nextCursor ? "page" : "ok") });
    }
  } finally { await ops.release("pipeline", token); }
}
