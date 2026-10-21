import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { signingFixture, authConfig } from "../support/auth";
import { localDatabase } from "../support/database";
import { NOW, observation } from "../support/domain";
import { Operations, later } from "../../src/operations/store";
import { adminRoutes } from "../../src/admin/routes";
import { calculateStatus } from "../../src/core/beam";
import type { Monitor, Signal } from "../../src/monitoring/health";
import { defaultSettings } from "../../src/core/models";
import worker from "../../src/index";
let fixture: Awaited<ReturnType<typeof signingFixture>>;
beforeAll(async () => { fixture = await signingFixture(); });
const all: Array<Awaited<ReturnType<typeof localDatabase>>> = [];
afterEach(() => { for (const d of all.splice(0)) d.close(); });
async function harness(scope: "production" | "test" = "production") {
  const d = await localDatabase(scope); all.push(d); const ops = new Operations(d.store);
  const sent: Signal[] = []; const monitor: Monitor = { async send(signal) { sent.push(signal); return true; } };
  const options = { at: NOW, transport: fixture.transport, keys: { balldontlie: "synthetic-key", odds_api: "synthetic-key" } };
  const token = await fixture.token();
  async function call(path: string, init?: RequestInit, at = NOW) {
    const request = new Request("https://admin.example.invalid" + path, { ...init, headers: { "Cf-Access-Jwt-Assertion": token, ...init?.headers } });
    return adminRoutes(request, authConfig, ops, fixture.transport, { ...options, at }, monitor);
  }
  async function state() { const response = await call("/admin/state"); expect(response.status).toBe(200); return await response.json() as { csrf: string; configuration: { revision: number }; settings: { revision: number } }; }
  async function post(path: string, body: Record<string, unknown>, headers?: Record<string, string>) {
    const s = await state();
    return call(path, { method: "POST", headers: { Origin: "https://admin.example.invalid", "Content-Type": "application/json", "X-CSRF-Token": s.csrf, ...headers }, body: JSON.stringify({ revision: s.configuration.revision, confirm: true, command: crypto.randomUUID(), ...body }) });
  }
  return { ...d, ops, call, state, post, sent };
}
describe("private owner controls", () => {
  it("serves a safe phone-friendly dashboard and authenticated diagnostics without CORS", async () => {
    const h = await harness("test");
    for (const path of ["/admin", "/admin/", "/admin/app.js", "/admin/style.css", "/admin/state", "/admin/status.json"]) {
      const r = await h.call(path); expect(r.status).toBe(200); expect(r.headers.has("Access-Control-Allow-Origin")).toBe(false); expect(r.headers.get("Cache-Control")).toBe("no-store"); expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      if (path === "/admin") expect(await r.text()).toContain("TEST — DOES NOT AFFECT KINGS");
      if (path === "/admin/app.js") expect(await r.text()).not.toMatch(/innerHTML|eval\(/);
    }
  });
  it("requires JWT even on static assets and TEST status", async () => {
    const h = await harness("test");
    for (const path of ["/admin", "/admin/app.js", "/admin/state", "/admin/status.json"]) {
      const response = await adminRoutes(new Request("https://admin.example.invalid" + path), authConfig, h.ops, fixture.transport, { at: NOW, transport: fixture.transport, keys: { balldontlie: "", odds_api: "" } }, { send: async () => false });
      expect(response.status).toBe(403);
    }
  });
  it.each([{ Origin: "https://attacker.invalid" }, { Origin: "null" }, { "Content-Type": "text/plain" }, { "Sec-Fetch-Site": "cross-site" }, { "X-CSRF-Token": "not-a-token" }])("rejects cross-origin/CSRF mutation %j", async headers => {
    const h = await harness();
    expect((await h.post("/admin/override", { mode: "FORCE_ON" }, headers as unknown as Record<string, string>)).status).toBe(403);
    expect((await h.store.settings()).revision).toBe(0);
  });
  it("requires explicit confirmation and rejects stale revisions", async () => {
    const h = await harness();
    expect((await h.post("/admin/override", { mode: "FORCE_ON", confirm: false })).status).toBe(400);
    expect((await h.post("/admin/override", { mode: "FORCE_ON", revision: 99 })).status).toBe(409);
    expect((await h.store.settings()).revision).toBe(0);
  });
  it("uses one-time owner-bound expiring CSRF nonces", async () => {
    const h = await harness(), s = await h.state();
    const init = { method: "POST", headers: { Origin: "https://admin.example.invalid", "Content-Type": "application/json", "X-CSRF-Token": s.csrf }, body: JSON.stringify({ mode: "FORCE_ON", command: "synthetic-command", revision: 0, confirm: true }) };
    expect((await h.call("/admin/override", init)).status).toBe(200);
    expect((await h.call("/admin/override", init)).status).toBe(403);
    const expired = await h.state();
    expect((await h.call("/admin/override", { ...init, headers: { ...init.headers, "X-CSRF-Token": expired.csrf } }, later(NOW, 11 * 60_000))).status).toBe(403);
  });
  it("persists seven categories, priority, strict policy, manual-only and restore defaults", async () => {
    const h = await harness(); const value = defaultSettings();
    value.eligibility.cup_regular = false; value.eligibility.regular = false; value.eligibility.summer_league = true; value.priority.reverse(); value.manualOnly = true; value.requireDualAgreementForOn = true;
    expect((await h.post("/admin/settings", { value })).status).toBe(200);
    expect((await h.store.settings()).value).toEqual(value);
    expect((await h.post("/admin/defaults", {})).status).toBe(200);
    expect((await h.store.settings()).value.eligibility).toEqual(defaultSettings().eligibility);
    expect((await h.store.settings()).value.priority).toEqual(["odds_api", "balldontlie"]);
  });
  it("applies authoritative manual override and audit without provider calls", async () => {
    const h = await harness();
    expect((await h.post("/admin/override", { mode: "FORCE_ON" })).status).toBe(200);
    expect(calculateStatus(await h.store.snapshot(NOW), NOW)).toMatchObject({ beam_on: true, source: "manual", verified: false });
    expect(h.sqlite.prepare("SELECT actor FROM audit_log WHERE action='override'").get()?.actor).toBe("synthetic-owner");
    expect((await h.post("/admin/override", { mode: "AUTO" })).status).toBe(200);
    expect(calculateStatus(await h.store.snapshot(NOW), NOW).beam_on).toBe(false);
  });
  it("deduplicates test email and limits repeated actions", async () => {
    const h = await harness();
    const command = "synthetic-test-alert";
    expect((await h.post("/admin/test-alert", { command })).status).toBe(200);
    expect((await h.post("/admin/test-alert", { command })).status).toBe(200);
    expect((await h.post("/admin/test-alert", {})).status).toBe(429);
    expect(h.sent).toEqual(["test"]);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_commands").get()?.n).toBe(1);
  });
  it("acknowledges an incident without falsely recovering it", async () => {
    const h = await harness(); await h.store.incident("synthetic:incident", "provider", null, true, NOW);
    expect((await h.post("/admin/acknowledge", { incident: "synthetic:incident" })).status).toBe(200);
    expect(h.sqlite.prepare("SELECT open,acknowledged_by FROM incidents WHERE key='synthetic:incident'").get()).toMatchObject({ open: 1, acknowledged_by: "synthetic-owner" });
  });
  it("allows audited completion resolution, rejects fake evidence and stale revisions", async () => {
    const h = await harness(); await h.store.ingest(observation());
    expect((await h.post("/admin/completion", { game: "bdl:9900001", completedAt: later(NOW, 60_000) })).status).toBe(400);
    expect((await h.post("/admin/completion", { game: "bdl:9900001", completedAt: NOW })).status).toBe(200);
    expect((await h.store.snapshot(NOW)).games[0].actualCompletedAt).toBe(NOW);
  });
  it("changes TEST team and clears current coverage/override while preserving history", async () => {
    const h = await harness("test");
    await h.post("/admin/override", { mode: "FORCE_ON" });
    expect((await h.post("/admin/operations", { revision: 0, value: { liveTest: true, seasonActive: false, historyStart: null }, team: "BOS" })).status).toBe(200);
    const snapshot = await h.store.snapshot(NOW);
    expect(snapshot.team).toBe("BOS"); expect(calculateStatus(snapshot, NOW).beam_on).toBe(false);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM overrides").get()?.n).toBe(2);
  });
  it("rejects a production team change", async () => {
    const h = await harness();
    expect((await h.post("/admin/operations", { value: { liveTest: true, seasonActive: true, historyStart: null }, team: "OKC" })).status).toBe(400);
    expect((await h.store.snapshot(NOW)).team).toBe("SAC");
  });
  it("does not expose credentials or accept injected settings content", async () => {
    const h = await harness();
    expect((await h.post("/admin/settings", { value: { ...defaultSettings(), apiKey: "synthetic-DO-NOT-USE" } })).status).toBe(400);
    const body = await (await h.call("/admin/state")).text();
    expect(body).not.toContain("synthetic-key"); expect(body).not.toContain("Cf-Access-Jwt");
  });
  it("keeps all externally reachable admin routes closed with missing activation/auth setup", async () => {
    const h = await harness();
    for (const env of [{ APP_ENV: "production" as const, DB: h.db }, { APP_ENV: "production" as const, DB: h.db, ADMIN_ENABLED: "true" }]) {
      expect((await worker.fetch(new Request("https://admin.example.invalid/admin"), env)).status).toBe(404);
    }
    expect((await worker.fetch(new Request("https://admin.example.invalid/admin/run", { method: "POST" }), { APP_ENV: "production", DB: h.db, ADMIN_ENABLED: "true" })).status).toBe(404);
  });
});

it("runs visibly labeled synthetic scenarios only in TEST without changing Beam evidence", async () => {
  const t = await harness("test"); const p = await harness();
  const before = t.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_observations").get()?.n;
  const r = await t.post("/admin/simulations", {}); expect(r.status).toBe(200);
  const body = await r.json() as { outcome: { label: string; scenarios: Array<{ result: string }> } };
  expect(body.outcome.label).toContain("SYNTHETIC TEST"); expect(body.outcome.scenarios).toHaveLength(11);
  expect(body.outcome.scenarios.every(s => s.result === "PASS")).toBe(true);
  expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_observations").get()?.n).toBe(before);
  expect((await p.post("/admin/simulations", {})).status).toBe(404);
});

it("bounds mutation bodies before parsing without echoing diagnostic input", async () => {
  const h = await harness();
  const response = await h.call("/admin/settings", { method: "POST", headers: { Origin: "https://admin.example.invalid", "Content-Type": "application/json" }, body: "synthetic-private-input".repeat(1_000) });
  expect(response.status).toBe(413);
  expect(await response.text()).not.toContain("synthetic-private-input");
  expect((await h.store.settings()).revision).toBe(0);
});
