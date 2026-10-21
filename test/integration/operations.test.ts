import { afterEach, describe, expect, it } from "vitest";
import { localDatabase } from "../support/database";
import { NOW, observation, odds } from "../support/domain";
import { Operations, later, shiftDay } from "../../src/operations/store";
import { operationBudget } from "../../src/operations/quota";
import { runOperations } from "../../src/scheduled";
import { result, type Transport } from "../../src/providers/adapter";
import { providerFixture } from "../fixtures/providers";
import { calculateStatus } from "../../src/core/beam";
const databases: Array<Awaited<ReturnType<typeof localDatabase>>> = [];
async function database(scope: "production" | "test" = "production") { const d = await localDatabase(scope); databases.push(d); return { ...d, ops: new Operations(d.store) }; }
afterEach(() => { for (const d of databases.splice(0)) d.close(); });
const keys = { balldontlie: "synthetic-bdl-DO-NOT-USE", odds_api: "synthetic-odds-DO-NOT-USE" };
const empty: Transport = async () => Response.json({ data: [], meta: { next_cursor: null } });
describe("durable scheduling and recovery", () => {
  it("bounds daily discovery, resumes remaining queries and makes no unnecessary no-game calls", async () => {
    const { store, ops, sqlite } = await database(); let requests = 0;
    const transport: Transport = async (...args) => { requests++; return empty(...args); };
    expect((await runOperations(store, { at: NOW, transport, keys })).checks).toHaveLength(3);
    expect((await runOperations(store, { at: later(NOW, 300_000), transport, keys })).checks).toHaveLength(2);
    expect((await runOperations(store, { at: later(NOW, 600_000), transport, keys })).checks).toHaveLength(0);
    expect(requests).toBe(5);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE completed_at IS NOT NULL").get()?.n).toBe(5);
    expect(calculateStatus(await store.snapshot(later(NOW, 600_000)), later(NOW, 600_000)).verified).toBe(false);
    expect((await ops.diagnostics(NOW)).scope).toBe("production");
  });
  it("pages durably without advancing completeness after a partial response", async () => {
    const { store, sqlite } = await database(); let called = 0;
    await runOperations(store, { at: NOW, keys, transport: async input => {
      const cursor = new URL(String(input)).searchParams.get("cursor"); called++;
      return Response.json({ data: [], meta: { next_cursor: cursor ? null : 123 } });
    } });
    expect(called).toBe(3);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE completed_at IS NOT NULL").get()?.n).toBe(0);
    await runOperations(store, { at: later(NOW, 300_000), keys, transport: async input => { expect(new URL(String(input)).searchParams.get("cursor")).toBe("123"); return Response.json({ data: [], meta: {} }); } });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE completed_at IS NOT NULL").get()?.n).toBe(3);
  });
  it("respects 429 Retry-After without calling it a completed empty schedule", async () => {
    const { store, sqlite } = await database(); let calls = 0;
    const transport: Transport = async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "1800" } }); };
    await runOperations(store, { at: NOW, keys, transport });
    await runOperations(store, { at: later(NOW, 300_000), keys, transport });
    expect(calls).toBe(1);
    expect(sqlite.prepare("SELECT outcome FROM provider_health").get()?.outcome).toBe("rate_limited");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE completed_at IS NOT NULL").get()?.n).toBe(0);
  });
  it("blocks overlapping scheduled/manual jobs and stale lease release", async () => {
    const { ops, store } = await database();
    const first = await ops.lease("pipeline", NOW);
    expect((await runOperations(store, { at: NOW, keys, transport: empty })).outcome).toBe("busy");
    const second = await ops.lease("pipeline", later(NOW, 120_000));
    expect(second).not.toBe(first);
    await ops.release("pipeline", first!);
    await ops.assertLease("pipeline", second!, later(NOW, 120_001));
    await expect(ops.assertLease("pipeline", first!, later(NOW, 120_001))).rejects.toThrow("lease_expired");
  });
  it("records and resumes older-than-Odds recovery, preserving historical uncertainty", async () => {
    const { store, ops, sqlite } = await database();
    await ops.configure({ liveTest: false, seasonActive: true, historyStart: "2026-10-01" }, 0, "history-start", "owner", NOW);
    for (let i = 0; i < 7; i++) await runOperations(store, { at: later(NOW, i * 300_000), keys, transport: empty });
    expect(sqlite.prepare("SELECT next_day FROM recovery_checkpoints").get()?.next_day).not.toBe("2026-10-01");
    expect(sqlite.prepare("SELECT open FROM incidents WHERE key='recovery:odds_history'").get()?.open).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE end_day<start_day").get()?.n).toBe(0);
    expect(calculateStatus(await store.snapshot(NOW), NOW).last_win).toBeNull();
  });
  it("checks Odds from persisted schedule when BALLDONTLIE is disabled; retries are batched and bounded", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation({ lifecycle: "scheduled", homeScore: null, awayScore: null, scheduledStartAt: later(NOW, -180 * 60_000) }));
    const settings = await store.settings(); await store.updateSettings({ ...settings.value, enabled: { balldontlie: false, odds_api: true } }, 0, "disable-bdl", "owner", NOW);
    await store.configureQuota("odds_api", later(NOW, -86_400_000), later(NOW, 20 * 86_400_000), 260);
    let calls = 0;
    const transport: Transport = async input => { expect(new URL(String(input)).pathname).toContain("/scores/"); calls++; return Response.json([], { headers: { "x-requests-last": "2", "x-requests-used": String(calls * 2), "x-requests-remaining": String(500 - calls * 2) } }); };
    // First fallback anchor is tipoff +150m, so the initial tick is already thirty minutes into the retries.
    for (const minutes of [0, 5, 20, 100, 150, 180]) await runOperations(store, { at: later(NOW, minutes * 60_000), keys, transport });
    expect(calls).toBe(4);
    expect(sqlite.prepare("SELECT credits_used FROM provider_health").get()?.credits_used).toBe(8);
    expect(sqlite.prepare("SELECT secondary_attempts FROM game_checks").get()?.secondary_attempts).toBe(4);
  });
  it("does not consume credit or call upstream before a billing period is explicitly configured", async () => {
    const { store } = await database();
    await store.ingest(observation());
    const value = (await store.settings()).value; await store.updateSettings({ ...value, enabled: { balldontlie: false, odds_api: true } }, 0, "odds-only", "owner", NOW);
    const report = await runOperations(store, { at: NOW, keys, transport: async () => { throw new Error("must not call upstream"); } });
    expect(report.checks).toEqual([{ provider: "odds_api", outcome: "budget_exhausted" }]);
  });
  it("fails on D1 writes rather than reporting successful work", async () => {
    const { store, failWrites } = await database(); failWrites(true);
    await expect(runOperations(store, { at: NOW, keys, transport: empty })).rejects.toThrow();
  });
  it("pauses TEST by default and cannot relabel a production database", async () => {
    const production = await database(), test = await database("test");
    expect((await runOperations(test.store, { at: NOW, keys, transport: empty })).outcome).toBe("paused");
    await expect(production.ops.configure({ liveTest: true, seasonActive: true, historyStart: null }, 0, "wrong-team", "owner", NOW, "OKC")).rejects.toThrow("invalid_test_team");
    await test.ops.configure({ liveTest: true, seasonActive: true, historyStart: null }, 0, "select-bos", "owner", NOW, "BOS");
    expect((await test.store.snapshot(NOW)).team).toBe("BOS");
    expect((await production.store.snapshot(NOW)).team).toBe("SAC");
    expect((await runOperations(test.store, { at: NOW, keys, transport: empty })).checks).toHaveLength(1);
    await expect(new Operations(new (production.store.constructor as typeof import('../../src/data/db').Store)(test.db, "production")).settings()).rejects.toThrow("database_scope_mismatch");
  });
});
describe("quota partitions and provider-header reconciliation", () => {
  it.each(["recovery", "diagnostics", "emergency"] as const)("keeps %s reserve separate from normal and TEST", async purpose => {
    const { store, ops, sqlite } = await database();
    await store.configureQuota("odds_api", NOW, later(NOW, 30 * 86_400_000), 260);
    const budget = operationBudget(ops, NOW, purpose);
    const cap = { recovery: 75, diagnostics: 20, emergency: 15 }[purpose];
    expect(await budget.reserve("odds_api", cap, NOW)).toBe(true);
    expect(await budget.reserve("odds_api", 1, NOW)).toBe(false);
    expect(sqlite.prepare("SELECT used FROM quota_counters WHERE provider='odds_api'").get()?.used).toBe(0);
    await budget.chargeExtra("odds_api", 1);
    expect(sqlite.prepare("SELECT used FROM quota_reserves").get()?.used).toBe(cap + 1);
    expect(await budget.reserve("odds_api", 1, NOW)).toBe(false);
  });
  it("pauses TEST before production reserve and honors production safety margin", async () => {
    for (const scope of ["production", "test"] as const) {
      const { ops } = await database(scope);
      await ops.health({ ...result("odds_api"), accountRemaining: 100, accountUsed: 400 }, NOW, 10);
      expect(await ops.ready("odds_api", NOW)).toBe(scope === "production");
      await ops.health({ ...result("odds_api"), accountRemaining: 50 }, later(NOW, 1_000), 12);
      expect(await ops.ready("odds_api", later(NOW, 1_000))).toBe(false);
    }
  });
  it("validates dates and rejects impossible scan ranges", async () => {
    const { ops } = await database();
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    await expect(ops.enqueue("2026-02-30", "2026-03-01", NOW)).rejects.toThrow("invalid_day");
    await expect(ops.enqueue("2026-01-01", "2026-02-01", NOW)).rejects.toThrow("invalid_scan_interval");
  });
});

describe("operational regression cases", () => {
  it("does not starve regular-game checks by repeatedly reopening earlier query types", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation({ lifecycle: "scheduled", homeScore: null, awayScore: null }));
    const types: string[] = [];
    const transport: Transport = async input => { types.push(new URL(String(input)).searchParams.get("season_type")!); return Response.json({ data: [], meta: {} }); };
    for (let i = 0; i < 4; i++) await runOperations(store, { at: later(NOW, i * 300_000), keys, transport });
    expect(types).toContain("regular"); expect(types.filter(t => t === "regular").length).toBeGreaterThan(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_sync WHERE completed_at IS NOT NULL").get()?.n).toBe(5);
  });
  it("initiates secondary verification immediately after an early final, and records quota headers", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation({ scheduledStartAt: later(NOW, -120 * 60_000) }));
    await store.configureQuota("odds_api", NOW, later(NOW, 20 * 86_400_000), 260);
    const value = (await store.settings()).value; await store.updateSettings({ ...value, enabled: { balldontlie: false, odds_api: true } }, 0, "early-final", "owner", NOW);
    let calls = 0;
    await runOperations(store, { at: NOW, keys, transport: async () => { calls++; return Response.json([], { headers: { "x-requests-last": "2", "x-requests-used": "2", "x-requests-remaining": "498" } }); } });
    expect(calls).toBe(1); expect(sqlite.prepare("SELECT used FROM quota_counters WHERE provider='odds_api'").get()?.used).toBe(2);
    expect(sqlite.prepare("SELECT credits_remaining FROM provider_health").get()?.credits_remaining).toBe(498);
  });
  it("creates a new recovery interval after an earlier recovery has already completed", async () => {
    const { store, ops, sqlite } = await database();
    await ops.stmt("INSERT INTO recovery_checkpoints(id,next_day,through_day,updated_at) VALUES(1,'2026-10-10','2026-10-09',?)", NOW).run();
    await ops.stmt("INSERT INTO runtime_health(id,last_completed) VALUES(1,'2026-10-18T05:00:00.000Z')").run();
    await runOperations(store, { at: NOW, keys, transport: empty });
    expect(sqlite.prepare("SELECT next_day,through_day FROM recovery_checkpoints").get()).toMatchObject({ next_day: "2026-10-17", through_day: "2026-10-20" });
  });
  it("resets history recovery when an owner moves the history boundary earlier", async () => {
    const { ops, sqlite } = await database();
    await ops.configure({ liveTest: false, seasonActive: true, historyStart: "2026-10-10" }, 0, "history-original", "owner", NOW);
    await ops.stmt("INSERT INTO recovery_checkpoints VALUES(1,'2026-10-20','2026-10-19',?)", NOW).run();
    await ops.configure({ liveTest: false, seasonActive: true, historyStart: "2026-10-01" }, 1, "history-earlier", "owner", NOW);
    expect(sqlite.prepare("SELECT * FROM recovery_checkpoints").get()).toBeUndefined();
  });
  it("does not advance checked_at on a no-request tick or a failed request", async () => {
    const { store } = await database();
    await runOperations(store, { at: NOW, keys, transport: empty });
    const at2 = later(NOW, 300_000); await runOperations(store, { at: at2, keys, transport: empty });
    const before = (await store.snapshot(at2)).checkedAt;
    const at3 = later(NOW, 600_000); await runOperations(store, { at: at3, keys, transport: empty });
    expect((await store.snapshot(at3)).checkedAt).toBe(before);
    expect(before).toBe(at2);
  });
  it("limits connection diagnostics to one real bounded primary lookup even after daily scans are complete", async () => {
    const { store } = await database();
    await runOperations(store, { at: NOW, keys, transport: empty });
    await runOperations(store, { at: later(NOW, 300_000), keys, transport: empty });
    let calls = 0;
    const report = await runOperations(store, { at: later(NOW, 600_000), keys, diagnostic: true, provider: "balldontlie", transport: async (...args) => { calls++; return empty(...args); } });
    expect(calls).toBe(1); expect(report.checks).toEqual([{ provider: "balldontlie", outcome: "ok" }]);
  });
  it("blocks a TEST team switch while a provider run holds the pipeline lease", async () => {
    const { ops } = await database("test"); const token = await ops.lease("pipeline", NOW);
    await expect(ops.configure({ liveTest: false, seasonActive: true, historyStart: null }, 0, "switch-team", "owner", NOW, "BOS")).rejects.toThrow("operations_busy");
    await ops.release("pipeline", token!);
  });
  it("prunes only transient records, retaining observations, audit and charged quotas", async () => {
    const { store, ops, sqlite } = await database();
    await store.ingest(observation()); await store.configureQuota("odds_api", NOW, later(NOW, 20 * 86_400_000), 260);
    expect(await store.budget(NOW).reserve("odds_api", 2, NOW)).toBe(true);
    await ops.cleanup(later(NOW, 2 * 3_600_000));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_reservations").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT used FROM quota_counters").get()?.used).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM provider_observations").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.n).toBe(1);
  });
});

it("publishes a dual verified synthetic result through the complete operational pipeline, then expires freshness", async () => {
  const { store, ops } = await database();
  await ops.configure({ liveTest: false, seasonActive: true, historyStart: "2026-10-21" }, 0, "full-pipeline", "owner", NOW);
  await store.configureQuota("odds_api", NOW, later(NOW, 20 * 86_400_000), 260);
  let secondaryCalls = 0;
  const transport: Transport = async input => {
    const u = new URL(String(input));
    if (u.hostname === "api.the-odds-api.com") { secondaryCalls++; const f = providerFixture("odds_api", "valid-final"); return Response.json(f.body, { headers: f.headers }); }
    return Response.json(u.searchParams.get("season_type") === "regular" ? providerFixture("balldontlie", "valid-final").body : { data: [], meta: {} });
  };
  for (let i = 0; i < 3; i++) await runOperations(store, { at: later(NOW, i * 300_000), keys, transport });
  const at = later(NOW, 600_000);
  expect(calculateStatus(await store.snapshot(at), at)).toMatchObject({ beam_on: true, verified: true, source: "dual", last_win: "2026-10-21" });
  expect(secondaryCalls).toBe(1);
  const stale = later(NOW, 30 * 60_000);
  expect(calculateStatus(await store.snapshot(stale), stale)).toMatchObject({ beam_on: true, verified: false });
});

it("uses emergency reserve only for a current-day provisional victory after ordinary quota is unavailable", async () => {
  const { store, sqlite } = await database();
  await store.ingest(observation());
  const value = (await store.settings()).value;
  await store.updateSettings({ ...value, enabled: { balldontlie: false, odds_api: true } }, 0, "emergency-source", "owner", NOW);
  await store.configureQuota("odds_api", NOW, later(NOW, 20 * 86_400_000), 0);
  let calls = 0;
  await runOperations(store, { at: NOW, keys, transport: async () => { calls++; return Response.json([]); } });
  expect(calls).toBe(1);
  expect(sqlite.prepare("SELECT purpose,used FROM quota_reserves").get()).toMatchObject({ purpose: "emergency", used: 2 });
  expect(sqlite.prepare("SELECT used FROM quota_counters WHERE provider='odds_api'").get()?.used).toBe(0);
});

it("allows the first bounded probe of a newly confirmed billing period without stale quota-header deadlock", async () => {
  const { store, ops } = await database();
  await ops.health({ ...result("odds_api"), accountUsed: 498, accountRemaining: 2 }, later(NOW, -86_400_000), 10);
  expect(await ops.ready("odds_api", NOW)).toBe(false);
  await store.configureQuota("odds_api", NOW, later(NOW, 30 * 86_400_000), 260);
  expect(await ops.ready("odds_api", NOW)).toBe(true);
  expect(await operationBudget(ops, NOW, "normal").reserve("odds_api", 2, NOW)).toBe(true);
});
