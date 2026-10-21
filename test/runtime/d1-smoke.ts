import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runOperations } from "../../src/scheduled";
import { Operations } from "../../src/operations/store";
import { Store } from "../../src/data/db";
import { CATEGORIES } from "../../src/core/models";
import { pacificDate } from "../../src/core/time";
import { parseBalldontlie } from "../../src/providers/balldontlie";
import { parseOddsApi } from "../../src/providers/oddsApi";
import { providerFixture } from "../fixtures/providers";

let outbound = 0;
function runtime(scope: "production" | "test") {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: `dist/${scope}/index.js`, compatibilityDate: "2026-10-21", cf: false,
    bindings: { APP_ENV: scope }, d1Databases: { DB: `local-runtime-${scope}` },
    outboundService: () => { outbound++; throw new Error("Worker outbound traffic forbidden in runtime smoke test"); },
  }));
}
const production = runtime("production"), test = runtime("test");
try {
  const stores: Store[] = [];
  for (const [scope, mf] of [["production", production], ["test", test]] as const) {
    const db = await mf.getD1Database("DB") as unknown as D1Database;
    // Split only at top-level DDL boundaries; keep the trigger BEGIN/END together.
    for (const name of readdirSync("migrations").filter(n => n.endsWith(".sql")).sort()) {
      const statements = readFileSync(`migrations/${name}`, "utf8").split(/;\s*(?=CREATE|PRAGMA|ALTER|INSERT INTO game_projection|$)/).map(s => s.trim()).filter(Boolean);
      for (const sql of statements) await db.prepare(sql).run();
    }
    const store = new Store(db, scope); await store.initialize(); stores.push(store);
  }
  const [store, testStore] = stores;
  let response = await production.dispatchFetch("https://local.invalid/status.json");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { beam_on: false, verified: false, last_win: null, mode: "auto", source: "none", checked_at: null });

  // Current-clock synthetic game: NEVER a claim about an actual NBA result.
  const at = new Date().toISOString(), start = new Date(Date.now() - 3_600_000).toISOString();
  const bdl = parseBalldontlie(providerFixture("balldontlie", "valid-final").body, { queryType: "regular" }, at);
  const odds = parseOddsApi(providerFixture("odds_api", "valid-final").body, at);
  bdl.observations[0].scheduledStartAt = start; odds.observations[0].scheduledStartAt = start;
  await store.applyResult(bdl, at);
  await store.applyResult(odds, at);
  await store.resolveCompletion("bdl:9900001", at, "local-test", "completion", at);
  await store.recordCoverage({ day: pacificDate(at), categories: [...CATEGORIES], sources: ["balldontlie", "odds_api"], complete: true, checkedAt: at, validUntil: new Date(Date.now() + 60_000).toISOString() });
  response = await production.dispatchFetch("https://local.invalid/status.json");
  const body = await response.json() as { beam_on: boolean; verified: boolean; source: string };
  assert.equal(response.status, 200); assert.equal(body.beam_on, true); assert.equal(body.verified, true); assert.equal(body.source, "dual");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await production.dispatchFetch("https://local.invalid/admin")).status, 404);
  assert.equal((await test.dispatchFetch("https://local.invalid/status.json")).status, 404);
  await testStore.setOverride("FORCE_ON", 0, "test-on", "local-test", at);
  assert.equal((await store.settings()).revision, 1);
  await assert.rejects(new Store(testStore.db, "production").snapshot(at), /database_scope_mismatch/);
  // Real D1 atomic batch rollback, including a command that failed mid-batch.
  await assert.rejects(store.db.batch([
    store.db.prepare("INSERT INTO audit_log(id,action,actor,at,detail) VALUES('rollback','test','local',?,'{}')").bind(at),
    store.db.prepare("INSERT INTO table_that_does_not_exist VALUES(1)"),
  ]));
  assert.equal(await store.db.prepare("SELECT id FROM audit_log WHERE id='rollback'").first(), null);
  const ops = new Operations(store);
  await ops.configure({ liveTest: false, seasonActive: false, historyStart: null }, 0, "local-operations", "local-test", at);
  const report = await runOperations(store, { at, keys: { balldontlie: "", odds_api: "" }, transport: async () => { throw new Error("No upstream calls expected"); } });
  assert.equal(report.outcome, "complete"); assert.equal(report.checks.length, 0);
  assert.ok(await store.db.prepare("SELECT last_completed FROM runtime_health WHERE id=1").first());
  assert.equal((await runOperations(testStore, { at, keys: { balldontlie: "", odds_api: "" }, transport: async () => { throw new Error("TEST must be paused"); } })).outcome, "paused");
  assert.equal(outbound, 0);
  console.log("PASS: actual workerd/local D1 migrations, parsed-fixture persistence, dual public status, scope isolation, closed admin/TEST, atomic rollback, durable operational bookkeeping, paused TEST, zero Worker outbound requests.");
} finally { await Promise.all([production.dispose(), test.dispose()]); }
