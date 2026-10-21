import { afterEach, describe, expect, it } from "vitest";
import { localDatabase } from "../support/database";
import { NOW, observation, odds } from "../support/domain";
import { CATEGORIES, defaultSettings } from "../../src/core/models";
import { calculateStatus } from "../../src/core/beam";
import { Store } from "../../src/data/db";
import { parseBalldontlie } from "../../src/providers/balldontlie";
import { parseOddsApi } from "../../src/providers/oddsApi";
import { providerFixture } from "../fixtures/providers";
import { freezeUtc } from "../support/time";
import worker from "../../src/index";
import { checkSources } from "../../src/core/check";
import { createMockHttp } from "../support/http";
import { SYNTHETIC_CREDENTIALS, assertNoSensitiveOutput } from "../support/diagnostics";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

const databases: Awaited<ReturnType<typeof localDatabase>>[] = [];
async function database(scope: "production" | "test" = "production") {
  const db = await localDatabase(scope); databases.push(db); return db;
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function cover(store: Store) {
  await store.recordCoverage({ day: "2026-10-21", categories: [...CATEGORIES], sources: ["balldontlie", "odds_api"], complete: true, checkedAt: NOW, validUntil: "2026-10-22T05:15:00.000Z" });
}
async function status(store: Store, at = NOW) { return calculateStatus(await store.snapshot(at), at); }

describe("local SQL persistence and complete core workflow", () => {
  it("ingests both parsed mocked providers and serves only derived public JSON", async () => {
    freezeUtc(NOW);
    const { store, db, counts } = await database();
    const bdl = parseBalldontlie(providerFixture("balldontlie", "valid-final").body, { queryType: "regular" }, NOW);
    const oddsResult = parseOddsApi(providerFixture("odds_api", "valid-final").body, NOW);
    await store.applyResult(bdl, NOW);
    expect(await status(store)).toMatchObject({ beam_on: true, verified: false });
    await store.applyResult(oddsResult, NOW); await cover(store);
    const writes = counts().writes;
    const response = await worker.fetch(new Request("https://scaffold.invalid/status.json"), { APP_ENV: "production", DB: db });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ beam_on: true, verified: true, last_win: "2026-10-21", source: "dual", mode: "auto", checked_at: NOW });
    expect(counts().writes).toBe(writes);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const restarted = new Store(db, "production");
    expect(await status(restarted)).toMatchObject({ beam_on: true, verified: true });
  });
  it("starts uninitialized history honestly and never auto-writes on a public read", async () => {
    freezeUtc(NOW);
    const { store, db, counts } = await database();
    const before = counts().writes;
    expect(await status(store)).toEqual({ beam_on: false, verified: false, last_win: null, mode: "auto", source: "none", checked_at: null });
    expect((await worker.fetch(new Request("https://scaffold.invalid/status.json"), { APP_ENV: "production", DB: db })).status).toBe(200);
    expect(counts().writes).toBe(before);
  });
  it("persists independent eligibility switches, revision guards and restore defaults", async () => {
    const { store } = await database(); await store.ingest(observation());
    const settings = defaultSettings(); settings.eligibility.regular = false;
    await store.updateSettings(settings, 0, "settings-1", "owner", NOW);
    expect((await status(store)).beam_on).toBe(false);
    await expect(store.updateSettings(defaultSettings(), 0, "stale", "owner", NOW)).rejects.toThrow("settings_conflict");
    await store.restoreDefaults(1, "reset", "owner", NOW);
    expect((await status(store)).beam_on).toBe(true);
    expect((await store.settings()).revision).toBe(2);
  });
  it("rejects invalid settings and disabling all sources outside manual-only", async () => {
    const { store } = await database(); const settings = defaultSettings();
    settings.enabled = { balldontlie: false, odds_api: false };
    await expect(store.updateSettings(settings, 0, "disable", "owner", NOW)).rejects.toThrow("invalid_settings");
    settings.manualOnly = true;
    await store.updateSettings(settings, 0, "manual-only", "owner", NOW);
    expect((await status(store)).mode).toBe("manual_only");
  });
  it("deduplicates observations and does not regress on reordered responses", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation()); await store.ingest(odds()); await cover(store);
    await store.ingest(observation());
    await store.ingest(observation({ lifecycle: "scheduled", homeScore: null, awayScore: null, observedAt: "2026-10-22T04:00:00.000Z" }));
    expect((await status(store)).verified).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM provider_observations").get()?.n).toBe(3);
  });
  it("withdraws disputed support and queues one opening and recovery event", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation());
    await store.ingest(odds({ awayScore: 90 }));
    await store.ingest(odds({ awayScore: 90 }));
    expect(await status(store)).toMatchObject({ beam_on: false, verified: false });
    await store.ingest(odds({ observedAt: "2026-10-22T05:01:00.000Z" }));
    await cover(store);
    expect(await status(store, "2026-10-22T05:01:00.000Z")).toMatchObject({ beam_on: true, verified: true });
    const notifications = sqlite.prepare("SELECT transition FROM notification_outbox WHERE incident_key='conflict:bdl:9900001' ORDER BY created_at").all();
    expect(notifications.map(r => r.transition)).toEqual(["open", "recovery"]);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM provider_observations").get()?.n).toBe(3);
  });
  it("stores an unmatched Odds result, then attaches it when BDL discovers the game", async () => {
    const { store, sqlite } = await database();
    expect(await store.ingest(odds())).toBe("unmatched");
    expect((await status(store)).beam_on).toBe(false);
    await store.ingest(observation({ observedAt: "2026-10-22T05:01:00.000Z" }));
    expect(await status(store, "2026-10-22T05:01:00.000Z")).toMatchObject({ beam_on: true, source: "dual" });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM unmatched_observations").get()?.n).toBe(0);
  });
  it("holds ambiguous candidate matching instead of guessing", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation());
    await store.ingest(observation({ providerGameId: "2" }));
    expect(await store.ingest(odds())).toBe("unmatched");
    expect((await status(store)).verified).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM unmatched_observations").get()?.n).toBe(1);
  });
  it("persists manual control and does not resurrect an expired duplicate command", async () => {
    const { store } = await database();
    await store.setOverride("FORCE_ON", 0, "force", "owner", NOW);
    expect(await status(store)).toMatchObject({ beam_on: true, mode: "manual_on", verified: false });
    const later = "2026-10-22T07:01:00.000Z";
    await store.setOverride("FORCE_ON", 0, "force", "owner", later);
    expect(await status(store, later)).toMatchObject({ beam_on: false, mode: "auto" });
    await store.setOverride("FORCE_OFF", 1, "off", "owner", later);
    await store.setOverride("AUTO", 2, "auto", "owner", later);
    expect((await status(store, later)).mode).toBe("auto");
  });
  it("resolves midnight uncertainty only through a recorded explicit command", async () => {
    const { store, sqlite } = await database();
    const at = "2026-10-22T07:15:00.000Z";
    await store.ingest(observation({ scheduledStartAt: "2026-10-22T06:55:00.000Z", observedAt: at }));
    expect(await status(store, at)).toMatchObject({ beam_on: false, last_win: null });
    await store.resolveCompletion("bdl:9900001", "2026-10-22T07:05:00.000Z", "owner", "resolve", at);
    expect(await status(store, at)).toMatchObject({ beam_on: true, last_win: "2026-10-22" });
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE id='resolve'").get()?.action).toBe("completion_resolution");
  });
  it("preserves accepted state and checked_at through provider failures", async () => {
    const { store } = await database(); await store.ingest(observation()); await cover(store);
    const checked = (await status(store)).checked_at;
    await store.applyResult({ provider: "odds_api", observations: [], errors: ["http_error"], nextCursor: null, credits: null, retryAfterSeconds: null }, "2026-10-22T05:01:00.000Z");
    expect(await status(store, "2026-10-22T05:01:00.000Z")).toMatchObject({ beam_on: true, verified: false, checked_at: checked });
  });
  it("rolls back failed batches without partially changing observations or settings", async () => {
    const { store, failWrites, sqlite } = await database();
    failWrites(true);
    await expect(store.ingest(observation())).rejects.toThrow("Synthetic D1 write failure");
    await expect(store.setOverride("FORCE_ON", 0, "failed", "owner", NOW)).rejects.toThrow();
    failWrites(false);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM provider_observations").get()?.n).toBe(0);
    expect((await store.settings()).revision).toBe(0);
  });
  it("returns a sanitized 503 on corrupt/missing persistence", async () => {
    freezeUtc(NOW);
    const { db, sqlite } = await database();
    sqlite.exec("DROP TABLE coverage");
    const response = await worker.fetch(new Request("https://scaffold.invalid/status.json"), { APP_ENV: "production", DB: db });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
  it("isolates production/TEST databases and rejects a swapped binding", async () => {
    const production = await database(), test = await database("test");
    await test.store.setOverride("FORCE_ON", 0, "test-only", "owner", NOW);
    expect((await status(production.store)).beam_on).toBe(false);
    await expect(new Store(production.db, "test").setOverride("FORCE_ON", 0, "attack", "owner", NOW)).rejects.toThrow("database_scope_mismatch");
    await expect(new Store(production.db, "test").initialize()).rejects.toThrow("database_scope_mismatch");
    const response = await worker.fetch(new Request("https://scaffold.invalid/status.json"), { APP_ENV: "production", DB: test.db });
    expect(response.status).toBe(503);
    expect((await worker.fetch(new Request("https://scaffold.invalid/status.json"), { APP_ENV: "test", DB: test.db })).status).toBe(404);
  });
  it("enforces persisted disjoint quota caps and explicit reset periods", async () => {
    const { store } = await database();
    await store.configureQuota("odds_api", "2026-10-15T00:00:00.000Z", "2026-11-15T00:00:00.000Z", 2);
    const budget = store.budget(NOW);
    expect(await budget.reserve("odds_api", 2, NOW)).toBe(true);
    expect(await budget.reserve("odds_api", 2, NOW)).toBe(false);
    expect(await store.budget("2026-11-16T00:00:00.000Z").reserve("odds_api", 2, "2026-11-16T00:00:00.000Z")).toBe(false);
    await expect(store.configureQuota("odds_api", "2026-10-16T00:00:00.000Z", "2026-11-16T00:00:00.000Z", 10)).rejects.toThrow("overlapping_quota");
    const test = await database("test");
    await expect(test.store.configureQuota("odds_api", NOW, "2026-11-01T00:00:00.000Z", 81)).rejects.toThrow("invalid_quota");
    await expect(store.configureQuota("balldontlie", NOW, "2026-10-22T05:01:00.000Z", 4)).rejects.toThrow("invalid_quota");
  });

  it("checks both enabled sources in priority order even when the first succeeds", async () => {
    const { store } = await database();
    await store.configureQuota("balldontlie", NOW, "2026-10-22T05:01:00.000Z", 3);
    await store.configureQuota("odds_api", "2026-10-15T00:00:00.000Z", "2026-11-15T00:00:00.000Z", 4);
    const mock = createMockHttp([
      { origin: "https://api.balldontlie.io", pathname: "/v1/games", outcome: { kind: "json", body: providerFixture("balldontlie", "valid-final").body } },
      { origin: "https://api.the-odds-api.com", pathname: "/v4/sports/basketball_nba/scores/", outcome: { kind: "json", body: providerFixture("odds_api", "valid-final").body, headers: { "x-requests-last": "2" } } },
    ]);
    const results = await checkSources(store, { transport: mock.fetch, keys: { balldontlie: SYNTHETIC_CREDENTIALS.bdl, odds_api: SYNTHETIC_CREDENTIALS.odds }, at: NOW, context: { queryType: "regular" }, startDate: "2026-10-21", endDate: "2026-10-21" });
    expect(results.map(r => r.provider)).toEqual(["balldontlie", "odds_api"]);
    expect((await status(store)).source).toBe("dual");
    expect((await status(store)).verified).toBe(false); // no automatic coverage claim
    assertNoSensitiveOutput(JSON.stringify(results)); mock.assertConsumed();
  });

  it("makes disabled sources ineligible for requests while preserving stored evidence", async () => {
    const { store } = await database(); await store.ingest(observation());
    const settings = defaultSettings(); settings.enabled.balldontlie = false;
    settings.priority.reverse();
    await store.updateSettings(settings, 0, "sources", "owner", NOW);
    await store.configureQuota("odds_api", "2026-10-15T00:00:00.000Z", "2026-11-15T00:00:00.000Z", 4);
    const mock = createMockHttp([{ origin: "https://api.the-odds-api.com", pathname: "/v4/sports/basketball_nba/scores/", outcome: { kind: "json", body: providerFixture("odds_api", "valid-final").body } }]);
    const result = await checkSources(store, { transport: mock.fetch, keys: { balldontlie: "unused-synthetic", odds_api: SYNTHETIC_CREDENTIALS.odds }, at: NOW, context: { queryType: "regular" }, startDate: "2026-10-21", endDate: "2026-10-21" });
    expect(result[1].errors).toEqual(["disabled"]);
    expect((await status(store)).beam_on).toBe(true); expect((await status(store)).verified).toBe(false);
    mock.assertConsumed();
  });

  it("rejects one of two concurrent settings changes without partial side effects", async () => {
    const { store, sqlite, db } = await database();
    const other = new Store(db, "production");
    const results = await Promise.allSettled([
      store.setOverride("FORCE_ON", 0, "race-a", "owner", NOW),
      other.setOverride("FORCE_OFF", 0, "race-b", "owner", NOW),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.settings()).revision).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM overrides").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM audit_log").get()?.n).toBe(1);
  });

  it("holds simultaneous contradictory observations until newer evidence resolves them", async () => {
    const { store } = await database();
    await store.ingest(observation()); await store.ingest(observation({ awayScore: 90 }));
    expect((await status(store)).beam_on).toBe(false);
    await store.ingest(observation({ observedAt: "2026-10-22T05:01:00.000Z" }));
    await store.ingest(odds({ observedAt: "2026-10-22T05:01:00.000Z" })); await cover(store);
    expect(await status(store, "2026-10-22T05:01:00.000Z")).toMatchObject({ beam_on: true, verified: true });
    await store.ingest(odds({ observedAt: "2026-10-22T04:59:00.000Z", awayScore: 90 }));
    expect((await status(store, "2026-10-22T05:01:00.000Z")).verified).toBe(true);
  });

  it("enforces the BDL rolling limit across minute boundaries", async () => {
    const { store } = await database();
    const boundary = "2026-10-22T05:01:00.000Z", justBefore = "2026-10-22T05:00:59.000Z";
    await store.configureQuota("balldontlie", NOW, boundary, 3);
    await store.configureQuota("balldontlie", boundary, "2026-10-22T05:02:00.000Z", 3);
    for (let n = 0; n < 3; n++) expect(await store.budget(justBefore).reserve("balldontlie", 1, justBefore)).toBe(true);
    expect(await store.budget(boundary).reserve("balldontlie", 1, boundary)).toBe(false);
    const later = "2026-10-22T05:01:59.000Z";
    expect(await store.budget(later).reserve("balldontlie", 1, later)).toBe(true);
  });

  it("expires backfilled wins without relighting an old Pacific day", async () => {
    const { store } = await database();
    await store.ingest(observation());
    expect(await status(store, "2026-10-24T05:00:00.000Z")).toMatchObject({ beam_on: false, last_win: "2026-10-21" });
    // No secondary observations can be invented once its history is unavailable.
    expect((await status(store, "2026-10-24T05:00:00.000Z")).verified).toBe(false);
  });
  it("retains complete history while compacting public-read evidence", async () => {
    const { store, sqlite } = await database();
    for (let n = 0; n < 20; n++) await store.ingest(observation({ observedAt: new Date(Date.parse("2026-10-22T04:00:00.000Z") + n * 60_000).toISOString() }));
    await store.ingest(odds()); await cover(store);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM provider_observations").get()?.n).toBe(21);
    const snap = await store.snapshot(NOW);
    expect(snap.games[0].observations.length).toBeLessThanOrEqual(3);
    expect(calculateStatus(snap, NOW)).toMatchObject({ beam_on: true, verified: true });
  });
  it("rebuilds the projection from existing observation history during migration", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation()); await store.ingest(odds()); await cover(store);
    sqlite.exec("DROP TRIGGER project_observation; DROP TRIGGER revise_evidence; DROP TABLE game_projection; DROP INDEX observations_provider_time; DROP INDEX observations_lifecycle; DROP INDEX observations_category;");
    sqlite.exec(readFileSync(new NodeURL("../../migrations/0002_read_projection.sql", import.meta.url), "utf8"));
    sqlite.exec(readFileSync(new NodeURL("../../migrations/0003_evidence_revision.sql", import.meta.url), "utf8"));
    expect(await status(store)).toMatchObject({ beam_on: true, verified: true });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM provider_observations").get()?.n).toBe(2);
  });
  it("rejects incident updates based on stale evidence revisions", async () => {
    const { store, sqlite } = await database();
    await store.ingest(observation());
    const old = (await store.snapshot(NOW)).games[0];
    await store.ingest(odds({ awayScore: 90, observedAt: "2026-10-22T05:01:00.000Z" }));
    await store.incident("conflict:bdl:9900001", "conflict", old.id, false, "2026-10-22T05:02:00.000Z", { gameId: old.id, revision: old.revision });
    expect(sqlite.prepare("SELECT open FROM incidents WHERE key='conflict:bdl:9900001'").get()?.open).toBe(1);
    expect((await status(store, "2026-10-22T05:02:00.000Z")).beam_on).toBe(false);
  });
  it("resolves an unmatched incident when both sources arrive at the same observation time", async () => {
    const { store, sqlite } = await database();
    await store.ingest(odds()); await store.ingest(observation());
    expect(sqlite.prepare("SELECT open FROM incidents WHERE key='unmatched:synthetic-odds-1'").get()?.open).toBe(0);
    expect((await status(store)).source).toBe("dual");
  });
});
