import { CATEGORIES, PROVIDERS, defaultSettings, validateSettings, type Category, type Coverage, type Game, type Observation, type Override, type Provider, type Scope, type Settings, type Snapshot } from "../core/models";
import { TEAMS } from "../core/teams";
import { instant, nextPacificMidnight, pacificDate } from "../core/time";
import { matchGame } from "../core/matching";
import { reconcile } from "../core/reconcile";
import type { AdapterResult, RequestBudget } from "../providers/adapter";

const json = (value: unknown) => JSON.stringify(value);
const safeId = (value: string) => /^[a-zA-Z0-9_.:@-]{1,180}$/.test(value);
async function digest(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json(value))))].map(n => n.toString(16).padStart(2, "0")).join("");
}
function cleanObservation(o: Observation): Observation {
  if (!o || !PROVIDERS.includes(o.provider) || !safeId(o.providerGameId) || !TEAMS.some(t => t.id === o.home) || !TEAMS.some(t => t.id === o.away) || o.home === o.away ||
    ![...CATEGORIES, "unknown"].includes(o.competition) || !["scheduled", "in_progress", "final", "postponed", "canceled", "other", "unknown"].includes(o.lifecycle) ||
    (o.provider === "odds_api" && (o.competition !== "unknown" || o.classificationProvenance !== null)) ||
    (o.competition !== "unknown" && (!o.classificationProvenance || !/^(bdl:(regular|playoffs|playin|preseason|ist)|reference:[a-z0-9_-]{1,64})$/.test(o.classificationProvenance)))) throw new Error("invalid_observation");
  if (o.season !== null && (!Number.isInteger(o.season) || o.season < 1946 || o.season > 2200)) throw new Error("invalid_observation");
  if (o.lifecycle === "final" && ([o.homeScore, o.awayScore].some(n => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) || o.homeScore === o.awayScore)) throw new Error("invalid_observation");
  return { provider: o.provider, providerGameId: o.providerGameId, home: o.home, away: o.away, season: o.season,
    scheduledStartAt: o.scheduledStartAt ? instant(o.scheduledStartAt) : null, observedAt: instant(o.observedAt),
    lifecycle: o.lifecycle, homeScore: o.lifecycle === "final" ? o.homeScore : null, awayScore: o.lifecycle === "final" ? o.awayScore : null,
    competition: o.competition, classificationProvenance: o.competition === "unknown" ? null : o.classificationProvenance };
}
export class Store {
  constructor(readonly db: D1Database, readonly scope: Scope) {}
  private statement(sql: string, ...args: unknown[]) { return this.db.prepare(sql).bind(...args); }
  private async identity(): Promise<{ scope: Scope; team: string }> {
    const row = await this.db.prepare("SELECT scope,team FROM app_metadata WHERE id=1").first<{ scope: Scope; team: string }>();
    if (!row || row.scope !== this.scope || !TEAMS.some(t => t.id === row.team) || (this.scope === "production" && row.team !== "SAC")) throw new Error("database_scope_mismatch");
    return row;
  }
  async initialize(team = this.scope === "production" ? "SAC" : "OKC"): Promise<void> {
    if (!TEAMS.some(t => t.id === team) || (this.scope === "production" && team !== "SAC")) throw new Error("invalid_team");
    const existing = await this.db.prepare("SELECT scope,team FROM app_metadata WHERE id=1").first<{ scope: string; team: string }>();
    if (existing && (existing.scope !== this.scope || existing.team !== team)) throw new Error("database_scope_mismatch");
    await this.db.batch([
      this.statement("INSERT OR IGNORE INTO app_metadata(id,scope,team) VALUES(1,?,?)", this.scope, team),
      this.statement("INSERT OR IGNORE INTO settings(id,value) VALUES(1,?)", json(defaultSettings())),
      ...TEAMS.flatMap(t => [this.statement("INSERT OR IGNORE INTO teams(id,name) VALUES(?,?)", t.id, t.name),
        this.statement("INSERT OR IGNORE INTO provider_team_ids(provider,provider_id,team) VALUES('balldontlie',?,?)", String(t.bdlId), t.id),
        ...t.aliases.map(a => this.statement("INSERT OR IGNORE INTO team_aliases(alias,team) VALUES(?,?)", a, t.id))]),
    ]);
    await this.identity();
  }
  async settings(): Promise<{ revision: number; value: Settings }> {
    await this.identity();
    const row = await this.db.prepare("SELECT revision,value FROM settings WHERE id=1").first<{ revision: number; value: string }>();
    if (!row) throw new Error("settings_missing");
    const value = JSON.parse(row.value) as Settings;
    validateSettings(value);
    return { revision: row.revision, value };
  }
  async snapshot(at: string): Promise<Snapshot> {
    const now = instant(at), today = pacificDate(now);
    // D1 batch gives a single consistent read transaction for the response.
    const data = await this.db.batch<Record<string, unknown>>([
      this.db.prepare("SELECT scope,team FROM app_metadata WHERE id=1"), this.db.prepare("SELECT value FROM settings WHERE id=1"),
      this.db.prepare("SELECT games.*,COALESCE(game_projection.revision,0) AS evidence_revision FROM games LEFT JOIN game_projection ON games.id=game_projection.game_id"), this.db.prepare("SELECT game_id,json_each.value AS value FROM game_projection,json_each(game_projection.observations)"),
      this.db.prepare("SELECT value FROM coverage"), this.db.prepare("SELECT mode,created_at,expires_at FROM overrides ORDER BY revision DESC LIMIT 1"),
      this.statement("SELECT provider FROM provider_failures WHERE day=? AND checked_at<=?", today, now),
      this.db.prepare("SELECT value FROM unmatched_observations"),
      this.db.prepare("SELECT succeeded_at FROM provider_health,app_metadata WHERE provider_health.team=app_metadata.team AND succeeded_at IS NOT NULL"),
      this.db.prepare("SELECT next_day,through_day FROM recovery_checkpoints WHERE next_day<=through_day"),
    ]);
    const identity = data[0].results[0] as unknown as { scope: string; team: string } | undefined;
    if (!identity || identity.scope !== this.scope || !TEAMS.some(t => t.id === identity.team) || (this.scope === "production" && identity.team !== "SAC")) throw new Error("database_scope_mismatch");
    const settings = JSON.parse(String(data[1].results[0]?.value)) as Settings;
    validateSettings(settings);
    const observations = data[3].results.map(r => cleanObservation(JSON.parse(String(r.value)) as Observation));
    const mapped = new Map<string, Observation[]>();
    for (const row of data[3].results) {
      const o = cleanObservation(JSON.parse(String(row.value)) as Observation);
      if (o.observedAt > now) continue;
      const id = String(row.game_id);
      mapped.set(id, [...(mapped.get(id) ?? []), o]);
    }
    const games: Game[] = data[2].results.map(r => ({ id: String(r.id), revision: Number(r.evidence_revision), home: String(r.home), away: String(r.away), season: Number(r.season), scheduledStartAt: r.start_at == null ? null : instant(r.start_at), actualCompletedAt: r.actual_completed_at == null ? null : instant(r.actual_completed_at), observations: mapped.get(String(r.id)) ?? [] }));
    const coverage = data[4].results.map(r => JSON.parse(String(r.value)) as Coverage);
    const overrideRow = data[5].results[0];
    const override: Override | null = overrideRow ? { mode: overrideRow.mode as Override["mode"], createdAt: instant(overrideRow.created_at), expiresAt: overrideRow.expires_at == null ? null : instant(overrideRow.expires_at) } : null;
    const failedSources = data[6].results.map(r => r.provider as Provider);
    let unmatchedRelevant = false;
    for (const row of data[7].results) {
      const o = cleanObservation(JSON.parse(String(row.value)) as Observation);
      if ((o.home === identity.team || o.away === identity.team) && o.observedAt <= now && pacificDate(o.observedAt) === today && (!o.scheduledStartAt || o.scheduledStartAt <= now)) unmatchedRelevant = true;
    }
    const checkedAt = [...data[8].results.map(r => instant(r.succeeded_at)).filter(t => t <= now), ...observations.filter(o => (o.home === identity.team || o.away === identity.team) && o.observedAt <= now).map(o => o.observedAt), ...coverage.filter(c => c.complete && c.checkedAt <= now).map(c => c.checkedAt)].sort().at(-1) ?? null;
    return { team: identity.team, settings, games, coverage, historyGaps: data[9].results.map(r => ({ start: String(r.next_day), end: String(r.through_day) })), override, failedSources, unmatchedRelevant, checkedAt };
  }
  async ingest(input: Observation): Promise<"stored" | "unmatched" | "ignored"> {
    const identity = await this.identity(), o = cleanObservation(input);
    if (o.home !== identity.team && o.away !== identity.team) return "ignored";
    const hash = await digest(o);
    const mapping = await this.statement("SELECT game_id FROM provider_game_ids WHERE provider=? AND provider_id=?", o.provider, o.providerGameId).first<{ game_id: string }>();
    const latest = await this.db.prepare("SELECT MAX(observed_at) AS at FROM provider_observations").first<{ at: string | null }>();
    const evaluationAt = latest?.at && latest.at > o.observedAt ? latest.at : o.observedAt;
    const snap = await this.snapshot(evaluationAt);
    let game = mapping ? snap.games.find(g => g.id === mapping.game_id) : undefined;
    if (mapping && (!game || game.home !== o.home || game.away !== o.away || (o.season !== null && game.season !== o.season))) {
      await this.statement("INSERT OR IGNORE INTO unmatched_observations(id,observed_at,value) VALUES(?,?,?)", hash, o.observedAt, json(o)).run();
      await this.incident(`identity:${o.provider}:${o.providerGameId}`, "identity", null, true, o.observedAt);
      return "unmatched";
    }
    if (!game && o.provider === "odds_api") game = matchGame(o, snap.games) ?? undefined;
    if (!game && o.provider === "odds_api") {
      await this.statement("INSERT OR IGNORE INTO unmatched_observations(id,observed_at,value) VALUES(?,?,?)", hash, o.observedAt, json(o)).run();
      await this.incident(`unmatched:${o.providerGameId}`, "unmatched", null, true, o.observedAt);
      return "unmatched";
    }
    if (!game && o.season === null) throw new Error("missing_season");
    const id = game?.id ?? `bdl:${o.providerGameId}`;
    await this.db.batch([
      this.statement("INSERT OR IGNORE INTO games(id,home,away,season,start_at,updated_at) VALUES(?,?,?,?,?,?)", id, o.home, o.away, o.season ?? game!.season, o.scheduledStartAt, o.observedAt),
      ...(o.provider === "balldontlie" ? [this.statement("UPDATE games SET start_at=COALESCE(?,start_at),updated_at=? WHERE id=? AND updated_at<=?", o.scheduledStartAt, o.observedAt, id, o.observedAt)] : []),
      this.statement("INSERT OR IGNORE INTO provider_game_ids(provider,provider_id,game_id) VALUES(?,?,?)", o.provider, o.providerGameId, id),
      this.statement("INSERT OR IGNORE INTO provider_observations(id,game_id,provider,provider_id,observed_at,value) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM provider_game_ids WHERE provider=? AND provider_id=? AND game_id=?)", hash, id, o.provider, o.providerGameId, o.observedAt, json(o), o.provider, o.providerGameId, id),
      this.statement("INSERT OR IGNORE INTO audit_log(id,action,actor,at,detail) VALUES(?,'observation','system',?,?)", hash, o.observedAt, json({ game: id, provider: o.provider })),
      this.statement("DELETE FROM unmatched_observations WHERE id=?", hash),
    ]);
    const updated = await this.snapshot(evaluationAt);
    const decision = reconcile(updated.games.find(g => g.id === id)!, updated.settings);
    const guard = { gameId: id, revision: decision.game.revision };
    await this.incident(`conflict:${id}`, "conflict", id, decision.disputed, evaluationAt, guard);
    await this.incident(`classification:${id}`, "classification", id, decision.competition === "unknown" && Boolean(decision.final), evaluationAt, guard);
    await this.incident(`timing:${id}`, "timing", id, Boolean(decision.final) && !decision.day, evaluationAt, guard);
    if (o.provider === "odds_api") await this.incident(`unmatched:${o.providerGameId}`, "unmatched", null, false, evaluationAt, guard);
    if (o.provider === "balldontlie") {
      const pending = await this.db.prepare("SELECT value FROM unmatched_observations").all<{ value: string }>();
      for (const row of pending.results) await this.ingest(JSON.parse(row.value) as Observation);
    }
    return "stored";
  }
  async incident(key: string, kind: string, game: string | null, open: boolean, at: string, evidence?: { gameId: string; revision: number }): Promise<void> {
    await this.identity();
    if (!safeId(key) || !/^[a-z_]{1,40}$/.test(kind)) throw new Error("invalid_incident");
    at = instant(at);
    await this.db.batch([
      this.statement("INSERT INTO incidents(key,kind,game_id,open,generation,first_seen,last_seen) SELECT ?,?,?,?,1,?,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM game_projection WHERE game_id=? AND revision=?)) ON CONFLICT(key) DO UPDATE SET open=excluded.open,generation=incidents.generation+CASE WHEN incidents.open<>excluded.open THEN 1 ELSE 0 END,last_seen=excluded.last_seen,acknowledged_at=CASE WHEN incidents.open<>excluded.open THEN NULL ELSE incidents.acknowledged_at END,acknowledged_by=CASE WHEN incidents.open<>excluded.open THEN NULL ELSE incidents.acknowledged_by END WHERE excluded.last_seen>=incidents.last_seen", key, kind, game, open ? 1 : 0, at, at, evidence?.gameId ?? null, evidence?.gameId ?? null, evidence?.revision ?? null),
      this.statement("INSERT OR IGNORE INTO notification_outbox(id,incident_key,transition,created_at) SELECT key||':'||generation,key,CASE WHEN open=1 THEN 'open' ELSE 'recovery' END,? FROM incidents WHERE key=? AND (open=1 OR generation>1)", at, key),
    ]);
  }
  async recordCoverage(input: Coverage): Promise<void> {
    await this.identity();
    const checkedAt = instant(input.checkedAt), validUntil = instant(input.validUntil);
    if (!/^\d{4}-\d\d-\d\d$/.test(input.day) || validUntil <= checkedAt || Date.parse(validUntil) - Date.parse(checkedAt) > 26 * 3_600_000 || input.categories.some(c => !CATEGORIES.includes(c)) || input.sources.some(p => !PROVIDERS.includes(p))) throw new Error("invalid_coverage");
    const value: Coverage = { day: input.day, categories: [...new Set(input.categories)], sources: [...new Set(input.sources)], complete: input.complete === true, checkedAt, validUntil };
    await this.statement("INSERT INTO coverage(day,value) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET value=excluded.value WHERE json_extract(coverage.value,'$.checkedAt')<=json_extract(excluded.value,'$.checkedAt')", input.day, json(value)).run();
  }
  async applyResult(result: AdapterResult, at: string): Promise<void> {
    const { value } = await this.settings();
    if (!value.enabled[result.provider]) return;
    at = instant(at);
    for (const o of result.observations) await this.ingest(o);
    const day = pacificDate(at);
    if (result.errors.length) {
      await this.statement("INSERT INTO provider_failures(provider,day,code,checked_at) VALUES(?,?,?,?) ON CONFLICT(provider,day) DO UPDATE SET code=excluded.code,checked_at=excluded.checked_at WHERE checked_at<=excluded.checked_at", result.provider, day, result.errors[0], at).run();
    } else {
      await this.statement("DELETE FROM provider_failures WHERE provider=? AND day=? AND checked_at<=?", result.provider, day, at).run();
    }
    await this.incident(`provider:${result.provider}`, "provider", null, result.errors.length > 0, at);
  }
  private async mutate(expected: number, command: string, actor: string, at: string, value: Settings, extra: D1PreparedStatement[], action: string): Promise<void> {
    await this.identity();
    validateSettings(value);
    if (!safeId(command) || !safeId(actor) || !Number.isSafeInteger(expected) || expected < 0) throw new Error("invalid_command");
    at = instant(at);
    const results = await this.db.batch([
      this.statement("UPDATE settings SET value=?,revision=revision+1,last_command=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", json(value), command, expected, command),
      ...extra,
      this.statement("INSERT OR IGNORE INTO audit_log(id,action,actor,at,detail) SELECT ?,?,?,?,? FROM settings WHERE id=1 AND last_command=?", command, action, actor, at, json({ revision: expected + 1, settings: value }), command),
    ]);
    if (!results[0].meta.changes && !await this.statement("SELECT id FROM audit_log WHERE id=? AND action=?", command, action).first()) throw new Error("settings_conflict");
  }
  async updateSettings(value: Settings, expected: number, command: string, actor: string, at: string): Promise<void> {
    await this.mutate(expected, command, actor, at, value, [], "settings");
  }
  async restoreDefaults(expected: number, command: string, actor: string, at: string): Promise<void> {
    const { value } = await this.settings();
    await this.updateSettings({ ...value, eligibility: defaultSettings().eligibility }, expected, command, actor, at);
  }
  async setOverride(mode: Override["mode"], expected: number, command: string, actor: string, at: string): Promise<void> {
    if (!["AUTO", "FORCE_ON", "FORCE_OFF"].includes(mode)) throw new Error("invalid_override");
    at = instant(at);
    const { value } = await this.settings();
    await this.mutate(expected, command, actor, at, value, [this.statement("INSERT OR IGNORE INTO overrides(command,revision,mode,created_at,expires_at) SELECT ?,revision,?,?,? FROM settings WHERE id=1 AND last_command=? AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", command, mode, at, mode === "AUTO" ? null : nextPacificMidnight(at), command, command)], "override");
  }
  async resolveCompletion(gameId: string, completedAt: string, actor: string, command: string, at: string): Promise<void> {
    const { value, revision } = await this.settings();
    const game = (await this.snapshot(at)).games.find(g => g.id === gameId);
    const firstFinal = game?.observations.filter(o => o.lifecycle === "final").map(o => o.observedAt).sort()[0];
    completedAt = instant(completedAt);
    if (!game || !firstFinal || completedAt > firstFinal || (game.scheduledStartAt && completedAt < game.scheduledStartAt)) throw new Error("invalid_completion_evidence");
    await this.mutate(revision, command, actor, at, value, [
      this.statement("UPDATE games SET actual_completed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM settings WHERE last_command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", completedAt, gameId, command, command),
      this.statement("UPDATE game_projection SET revision=revision+1 WHERE game_id=? AND EXISTS(SELECT 1 FROM settings WHERE last_command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", gameId, command, command),
    ], "completion_resolution");
    await this.incident(`timing:${gameId}`, "timing", gameId, false, at);
  }
  async configureQuota(provider: Provider, start: string, end: string, cap: number): Promise<void> {
    await this.identity();
    start = instant(start); end = instant(end);
    const max = provider === "odds_api" ? this.scope === "production" ? 260 : 80 : this.scope === "production" ? 3 : 1;
    if (!PROVIDERS.includes(provider) || start >= end || !Number.isSafeInteger(cap) || cap < 0 || cap > max || (provider === "balldontlie" && Date.parse(end) - Date.parse(start) !== 60_000)) throw new Error("invalid_quota");
    if (await this.statement("SELECT provider FROM quota_counters WHERE provider=? AND period_start<>? AND period_start<? AND period_end>?", provider, start, end, start).first()) throw new Error("overlapping_quota");
    const existing = await this.statement("SELECT period_end FROM quota_counters WHERE provider=? AND period_start=?", provider, start).first<{ period_end: string }>();
    if (existing && existing.period_end !== end) throw new Error("quota_period_mismatch");
    await this.statement("INSERT INTO quota_counters(provider,period_start,period_end,cap) VALUES(?,?,?,?) ON CONFLICT(provider,period_start) DO UPDATE SET cap=MIN(quota_counters.cap,excluded.cap)", provider, start, end, cap).run();
  }
  budget(at: string): RequestBudget {
    const reserved = new Map<Provider, string>();
    return {
      reserve: async (provider, cost, timestamp) => {
        const { value } = await this.settings();
        if (instant(at) !== instant(timestamp) || !value.enabled[provider] || !Number.isInteger(cost) || cost < 1) return false;
        const row = await this.statement("SELECT period_start FROM quota_counters WHERE provider=? AND period_start<=? AND period_end>?", provider, at, at).first<{ period_start: string }>();
        if (!row) return false;
        const token = crypto.randomUUID();
        const since = new Date(Date.parse(at) - 60_000).toISOString();
        const rollingCap = this.scope === "production" ? 3 : 1;
        const writes = await this.db.batch([
          this.statement("UPDATE quota_counters SET used=used+?,last_reservation=? WHERE provider=? AND period_start=? AND used+?<=cap AND (?<>'balldontlie' OR (SELECT COALESCE(SUM(cost),0) FROM request_reservations WHERE provider=? AND at>? AND at<=?)+?<=?)", cost, token, provider, row.period_start, cost, provider, provider, since, at, cost, rollingCap),
          this.statement("INSERT INTO request_reservations(id,provider,at,cost) SELECT ?,?,?,? FROM quota_counters WHERE provider=? AND period_start=? AND last_reservation=?", token, provider, at, cost, provider, row.period_start, token),
        ]);
        const write = writes[0];
        if (write.meta.changes) reserved.set(provider, row.period_start);
        return write.meta.changes === 1;
      },
      chargeExtra: async (provider, cost) => {
        if (!Number.isSafeInteger(cost) || cost <= 0 || !reserved.has(provider)) throw new Error("invalid_charge");
        await this.statement("UPDATE quota_counters SET used=used+? WHERE provider=? AND period_start=?", cost, provider, reserved.get(provider)!).run();
      },
    };
  }
}
