import { Store } from "../data/db";
import { TEAMS } from "../core/teams";
import { instant } from "../core/time";
import type { QueryType } from "../core/eligibility";
import type { AdapterResult } from "../providers/adapter";

export const QUERY_TYPES: QueryType[] = ["regular", "playoffs", "playin", "preseason", "ist"];
export interface OperationalSettings { liveTest: boolean; seasonActive: boolean; historyStart: string | null }
export const operationalDefaults = (): OperationalSettings => ({ liveTest: false, seasonActive: true, historyStart: null });
export const later = (at: string, milliseconds: number) => new Date(Date.parse(instant(at)) + milliseconds).toISOString();
export function day(value: string): string {
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value + "T12:00:00Z")) || new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value) throw new Error("invalid_day");
  return value;
}
export const shiftDay = (value: string, days: number) => later(day(value) + "T12:00:00.000Z", days * 86_400_000).slice(0, 10);
export interface Scan { id: string; query_type: QueryType; start_day: string; end_day: string; cursor: string | null; next_at: string; completed_at: string | null; failures: number }
/** Every method checks the database identity; TEST never receives a production binding. */
export class Operations {
  constructor(readonly store: Store) {}
  private async check() { await this.store.settings(); }
  stmt(sql: string, ...args: unknown[]) { return this.store.db.prepare(sql).bind(...args); }
  async settings(): Promise<{ revision: number; value: OperationalSettings }> {
    await this.check();
    const row = await this.stmt("SELECT revision,value FROM operational_settings WHERE id=1").first<{ revision: number; value: string }>();
    const value = row ? JSON.parse(row.value) as OperationalSettings : operationalDefaults();
    if (typeof value.liveTest !== "boolean" || typeof value.seasonActive !== "boolean" || (value.historyStart !== null && day(value.historyStart) !== value.historyStart) || Object.keys(value).sort().join() !== "historyStart,liveTest,seasonActive") throw new Error("invalid_operational_settings");
    return { revision: row?.revision ?? 0, value };
  }
  async configure(value: OperationalSettings, revision: number, command: string, actor: string, at: string, team?: string): Promise<void> {
    await this.check(); instant(at);
    if (!/^[a-zA-Z0-9_.:@-]{1,180}$/.test(command) || !/^[a-zA-Z0-9_.:@-]{1,180}$/.test(actor) || !Number.isSafeInteger(revision) || revision < 0 || typeof value.liveTest !== "boolean" || typeof value.seasonActive !== "boolean" || (value.historyStart !== null && day(value.historyStart) !== value.historyStart) || Object.keys(value).sort().join() !== "historyStart,liveTest,seasonActive") throw new Error("invalid_operational_settings");
    if (team !== undefined && (this.store.scope !== "test" || !TEAMS.some(t => t.id === team))) throw new Error("invalid_test_team");
    const oldOperations = (await this.settings()).value;
    if (value.historyStart && value.historyStart > at.slice(0, 10)) throw new Error("invalid_history_start");
    const oldTeam = (await this.store.snapshot(at)).team;
    const changeLease = team && team !== oldTeam ? await this.lease("pipeline", at) : undefined;
    if (team && team !== oldTeam && !changeLease) throw new Error("operations_busy");
    // A team switch invalidates discovery evidence; history remains for audit, scoped by team in core.
    const statements = [
      this.stmt("INSERT OR IGNORE INTO operational_settings(id,value) VALUES(1,?)", JSON.stringify(operationalDefaults())),
      this.stmt("UPDATE operational_settings SET value=?,revision=revision+1,command=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", JSON.stringify(value), command, revision, command),
      ...(team && team !== oldTeam ? [
        this.stmt("UPDATE app_metadata SET team=? WHERE id=1 AND EXISTS(SELECT 1 FROM operational_settings WHERE command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", team, command, command),
        this.stmt("UPDATE settings SET revision=revision+1,last_command=? WHERE id=1 AND EXISTS(SELECT 1 FROM operational_settings WHERE command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", command, command, command),
        this.stmt("INSERT OR IGNORE INTO overrides(command,revision,mode,created_at,expires_at) SELECT ?,revision,'AUTO',?,NULL FROM settings WHERE last_command=? AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", command, at, command, command),
        ...["coverage", "schedule_sync", "recovery_checkpoints", "game_checks", "provider_failures"].map(table => this.stmt(`DELETE FROM ${table} WHERE EXISTS(SELECT 1 FROM operational_settings WHERE command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)`, command, command)),
      ] : []),
      ...(oldOperations.historyStart !== value.historyStart ? [this.stmt("DELETE FROM recovery_checkpoints WHERE EXISTS(SELECT 1 FROM operational_settings WHERE command=?) AND NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?)", command, command)] : []),
      this.stmt("INSERT OR IGNORE INTO audit_log(id,action,actor,at,detail) SELECT ?,'operations',?,?,? FROM operational_settings WHERE command=?", command, actor, at, JSON.stringify({ value, team: team ?? oldTeam, revision: revision + 1 }), command),
    ];
    try {
      const result = await this.store.db.batch(statements);
      if (!result[1].meta.changes && !await this.stmt("SELECT id FROM audit_log WHERE id=? AND action='operations'", command).first()) throw new Error("settings_conflict");
    } finally { if (changeLease) await this.release("pipeline", changeLease); }
  }
  async lease(name: string, at: string, ttlMs = 120_000): Promise<string | null> {
    await this.check(); instant(at);
    const token = crypto.randomUUID();
    const write = await this.stmt("INSERT INTO job_leases(name,token,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE job_leases.expires_at<=?", name, token, later(at, ttlMs), at).run();
    return write.meta.changes === 1 ? token : null;
  }
  async assertLease(name: string, token: string, at: string): Promise<void> {
    await this.check();
    if (!await this.stmt("SELECT token FROM job_leases WHERE name=? AND token=? AND expires_at>?", name, token, instant(at)).first()) throw new Error("lease_expired");
  }
  async release(name: string, token: string): Promise<void> { await this.check(); await this.stmt("DELETE FROM job_leases WHERE name=? AND token=?", name, token).run(); }
  async enqueue(start: string, end: string, at: string): Promise<void> {
    await this.check(); day(start); day(end); instant(at);
    if (start > end || Date.parse(end) - Date.parse(start) > 7 * 86_400_000) throw new Error("invalid_scan_interval");
    await this.store.db.batch(QUERY_TYPES.map(type => this.stmt("INSERT OR IGNORE INTO schedule_sync(id,query_type,start_day,end_day,next_at) VALUES(?,?,?,?,?)", `${start}:${end}:${type}`, type, start, end, at)));
  }
  async dueScan(at: string): Promise<Scan | null> {
    await this.check();
    return this.stmt("SELECT * FROM schedule_sync WHERE completed_at IS NULL AND next_at<=? ORDER BY end_day DESC,query_type LIMIT 1", instant(at)).first<Scan>();
  }
  async saveScan(scan: Scan, result: AdapterResult, at: string): Promise<void> {
    await this.check();
    const failed = result.errors.length > 0 || result.nextCursor === scan.cursor && result.nextCursor !== null;
    await this.stmt("UPDATE schedule_sync SET cursor=?,completed_at=?,next_at=?,failures=? WHERE id=?", failed ? scan.cursor : result.nextCursor, !failed && !result.nextCursor ? at : null,
      later(at, failed ? Math.max(300_000, (result.retryAfterSeconds ?? 0) * 1_000, Math.min(6 * 3_600_000, 300_000 * 2 ** Math.min(scan.failures, 6))) : 60_000), failed ? scan.failures + 1 : 0, scan.id).run();
  }
  async health(result: AdapterResult, at: string, latencyMs: number): Promise<void> {
    await this.check();
    const failed = result.errors.length > 0;
    const team = (await this.store.snapshot(at)).team;
    const old = await this.stmt("SELECT failures FROM provider_health WHERE provider=?", result.provider).first<{ failures: number }>();
    const failures = failed ? (old?.failures ?? 0) + 1 : 0;
    const jitter = (result.provider === "balldontlie" ? 7 : 17) * 1_000;
    const next = later(at, failed ? Math.max((result.retryAfterSeconds ?? 0) * 1_000, Math.min(6 * 3_600_000, 60_000 * 2 ** Math.min(failures, 8)) + jitter) : 0);
    await this.stmt("INSERT INTO provider_health(provider,team,attempted_at,succeeded_at,latency_ms,outcome,next_at,failures,credits_used,credits_remaining) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET team=excluded.team,attempted_at=excluded.attempted_at,succeeded_at=CASE WHEN provider_health.team=excluded.team THEN COALESCE(excluded.succeeded_at,provider_health.succeeded_at) ELSE excluded.succeeded_at END,latency_ms=excluded.latency_ms,outcome=excluded.outcome,next_at=excluded.next_at,failures=excluded.failures,credits_used=COALESCE(excluded.credits_used,provider_health.credits_used),credits_remaining=COALESCE(excluded.credits_remaining,provider_health.credits_remaining) WHERE excluded.attempted_at>=provider_health.attempted_at", result.provider, team, at, failed ? null : at, Math.max(0, Math.round(latencyMs)), result.errors[0] ?? "ok", next, failures, result.accountUsed ?? null, result.accountRemaining ?? null).run();
  }
  async ready(provider: string, at: string): Promise<boolean> {
    await this.check();
    const row = await this.stmt("SELECT next_at,attempted_at,credits_remaining,credits_used FROM provider_health WHERE provider=?", provider).first<{ next_at: string; attempted_at: string; credits_remaining: number | null; credits_used: number | null }>();
    const period = provider === "odds_api" ? await this.stmt("SELECT period_start FROM quota_counters WHERE provider='odds_api' AND period_start<=? AND period_end>?", at, at).first<{ period_start: string }>() : null;
    // A newly confirmed billing cycle permits its first bounded probe; old-cycle account headers
    // must not deadlock all future checks. Local counters reset only through explicit period configuration.
    const oldCycle = Boolean(period && row && row.attempted_at < period.period_start);
    // Disjoint local caps plus conservative account-header reconciliation. TEST stops first.
    return (!row || row.next_at <= at) && (provider !== "odds_api" || oldCycle || Math.min(row?.credits_remaining ?? 500, 500 - (row?.credits_used ?? 0)) >= (this.store.scope === "test" ? 152 : 52));
  }
  async cleanup(at: string): Promise<void> {
    await this.check(); instant(at);
    // Only transient locks/nonces and the short rolling-rate ledger are pruned. Financial counters,
    // observations, overrides, incidents and audit history are retained.
    await this.store.db.batch([
      this.stmt("DELETE FROM request_reservations WHERE at<?", later(at, -3_600_000)),
      this.stmt("DELETE FROM csrf_nonces WHERE expires_at<=?", at),
      this.stmt("DELETE FROM job_leases WHERE expires_at<=?", at),
    ]);
  }
  async diagnostics(at: string) {
    const settings = await this.settings();
    const snapshot = await this.store.snapshot(at);
    const tables = ["provider_health", "quota_counters", "quota_reserves", "incidents", "notification_outbox", "runtime_health", "schedule_sync", "recovery_checkpoints", "game_checks", "audit_log", "admin_commands"] as const;
    const values = await this.store.db.batch(tables.map(table => this.stmt(`SELECT * FROM ${table} LIMIT 100`)));
    return { scope: this.store.scope, team: snapshot.team, settings, snapshot, records: Object.fromEntries(tables.map((table, i) => [table, values[i].results])) };
  }
}
