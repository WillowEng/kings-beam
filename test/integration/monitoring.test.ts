import { afterEach, describe, expect, it, vi } from "vitest";
import { localDatabase } from "../support/database";
import { NOW } from "../support/domain";
import { Operations, later } from "../../src/operations/store";
import { deliverOutbox } from "../../src/monitoring/alerts";
import { healthchecks, type Signal } from "../../src/monitoring/health";
import { emailNotifications } from "../../src/monitoring/email";
import worker from "../../src/index";
const all: Array<Awaited<ReturnType<typeof localDatabase>>> = [];
async function harness(scope: "production" | "test" = "production") { const d = await localDatabase(scope); all.push(d); return { ...d, ops: new Operations(d.store) }; }
afterEach(() => { for (const d of all.splice(0)) d.close(); });
describe("durable incident and recovery notifications", () => {
  it("sends one transition per incident generation and never repeats acknowledged delivery", async () => {
    const { store, ops, sqlite } = await harness(); const delivered: Signal[] = [];
    const monitor = { async send(signal: Signal) { delivered.push(signal); return true; } };
    await store.incident("a", "provider", null, true, NOW);
    await store.incident("a", "provider", null, true, NOW);
    expect(await deliverOutbox(ops, monitor, NOW)).toEqual({ delivered: 1, failed: 0 });
    expect(await deliverOutbox(ops, monitor, NOW)).toEqual({ delivered: 0, failed: 0 });
    await store.incident("a", "provider", null, false, later(NOW, 1_000));
    await store.incident("a", "provider", null, false, later(NOW, 2_000));
    await deliverOutbox(ops, monitor, later(NOW, 2_000));
    expect(delivered).toEqual(["open", "recovery"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE delivered_at IS NOT NULL").get()?.n).toBe(2);
  });
  it("retries failed delivery with backoff and a stable ID without leaking errors", async () => {
    const { store, ops, sqlite } = await harness(); const ids: string[] = []; let fail = true;
    await store.incident("a", "provider", null, true, NOW);
    const monitor = { async send(_signal: Signal, _scope: string, id: string) { ids.push(id); if (fail) throw new Error("synthetic-private-service-error"); return true; } };
    expect(await deliverOutbox(ops, monitor, NOW)).toEqual({ delivered: 0, failed: 1 });
    expect(await deliverOutbox(ops, monitor, later(NOW, 30_000))).toEqual({ delivered: 0, failed: 0 });
    fail = false;
    expect(await deliverOutbox(ops, monitor, later(NOW, 60_000))).toEqual({ delivered: 1, failed: 0 });
    expect(ids).toEqual(["a:1", "a:1"]);
    expect(sqlite.prepare("SELECT attempts FROM notification_outbox").get()?.attempts).toBe(2);
  });
  it("preserves separate incident transitions while another incident is still open", async () => {
    const { store, ops, sqlite } = await harness(); const events: string[] = [];
    await store.incident("a", "provider", null, true, NOW);
    await store.incident("b", "quota", null, true, NOW);
    await store.incident("a", "provider", null, false, later(NOW, 1_000));
    await deliverOutbox(ops, { async send(signal, scope, id) { events.push([signal, scope, id].join("/")); return true; } }, later(NOW, 1_000));
    expect(events).toEqual(["open/production/a:1", "open/production/b:1", "recovery/production/a:2"]);
    expect(sqlite.prepare("SELECT open FROM incidents WHERE key='b'").get()?.open).toBe(1);
  });
  it("never duplicates concurrently running outbox dispatchers", async () => {
    const { store, ops } = await harness(); await store.incident("a", "provider", null, true, NOW);
    const token = await ops.lease("outbox", NOW);
    expect(await deliverOutbox(ops, { send: async () => { throw new Error("must not send"); } }, NOW)).toEqual({ delivered: 0, failed: 0 });
    await ops.release("outbox", token!);
  });
  it("does not mark rows delivered when D1 cannot persist the delivery result", async () => {
    const { store, ops, failWrites, sqlite } = await harness(); await store.incident("a", "provider", null, true, NOW);
    await expect(deliverOutbox(ops, { async send() { failWrites(true); return true; } }, NOW)).rejects.toThrow();
    expect(sqlite.prepare("SELECT delivered_at FROM notification_outbox").get()?.delivered_at).toBeNull();
  });
  it("separates production and TEST deliveries without writable cross-bindings", async () => {
    const p = await harness(), t = await harness("test"); const scopes: string[] = [];
    await p.store.incident("a", "provider", null, true, NOW); await t.store.incident("a", "provider", null, true, NOW);
    await deliverOutbox(t.ops, { async send(_signal, scope) { scopes.push(scope); return true; } }, NOW);
    expect(scopes).toEqual(["test"]);
    expect(p.sqlite.prepare("SELECT delivered_at FROM notification_outbox").get()?.delivered_at).toBeNull();
  });
});
describe("inactive external integrations", () => {
  // Deliberately synthetic check identifiers. They are never sent on the network.
  const heartbeat = "https://hc-ping.com/00000000-0000-0000-0000-000000000001";
  const test = "https://hc-ping.com/00000000-0000-0000-0000-000000000002";
  it("sends heartbeat and test alert to separate checks through explicit mocks", async () => {
    const calls: Array<{ pathLength: number; fail: boolean }> = [];
    const monitor = healthchecks({ scope: "test", heartbeat, test }, async input => { const u = new URL(String(input)); calls.push({ pathLength: u.pathname.length, fail: u.pathname.endsWith("/fail") }); return new Response(null, { status: 200 }); });
    expect(await monitor.send("heartbeat", "test", "safe-id")).toBe(true);
    expect(await monitor.send("test", "test", "safe-id")).toBe(true);
    expect(calls.map(c => c.fail)).toEqual([false, true]);
    expect(await monitor.send("heartbeat", "production", "safe-id")).toBe(false);
  });
  it.each([undefined, "http://hc-ping.com/invalid", "https://evil.invalid/invalid", "https://hc-ping.com/invalid", "https://hc-ping.com/00000000-0000-0000-0000-000000000001?secret=synthetic"])("fails closed on invalid/missing monitoring configuration #%#", async value => {
    const monitor = healthchecks({ scope: "production", heartbeat: value }, async () => { throw new Error("must not request"); });
    expect(await monitor.send("heartbeat", "production", "safe-id")).toBe(false);
  });
  it("rejects reused monitoring checks and swallows raw transport errors", async () => {
    expect(await healthchecks({ scope: "test", heartbeat, test: heartbeat }, async () => { throw new Error("must not request"); }).send("heartbeat", "test", "safe-id")).toBe(false);
    expect(await healthchecks({ scope: "test", heartbeat }, async () => { throw new Error("synthetic-private-error"); }).send("heartbeat", "test", "safe-id")).toBe(false);
  });
  it("keeps scheduled work, email and external heartbeat inactive in default Worker configuration", async () => {
    await worker.scheduled({} as ScheduledController, { APP_ENV: "production" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await emailNotifications({ scope: "test" }).send("open", "test", "safe-id")).toBe(false);
  });
  it("constructs bounded private email messages through an injected free-routing binding", async () => {
    const sent: string[] = [];
    const sender = emailNotifications({ scope: "test", from: "beam@example.invalid", to: "owner@example.invalid", message: (_from, _to, raw) => ({ raw } as unknown as EmailMessage), binding: { async send(message: EmailMessage) { sent.push((message as unknown as { raw: string }).raw); } } as unknown as SendEmail });
    expect(await sender.send("open", "test", "incident:1")).toBe(true);
    expect(await sender.send("recovery", "test", "incident:2")).toBe(true);
    expect(await sender.send("test", "production", "incident:3")).toBe(false);
    expect(sent).toHaveLength(2); expect(sent[0]).toContain("TEST"); expect(sent[1]).toContain("recovered");
    expect(sent.join("")).not.toMatch(/apiKey|hc-ping|provider score/);
  });
  it("rejects email header injection and secret-bearing identifiers", async () => {
    const sender = emailNotifications({ scope: "test", from: "beam@example.invalid\r\nBcc: bad@example.invalid", to: "owner@example.invalid", binding: {} as SendEmail });
    expect(await sender.send("open", "test", "incident:1")).toBe(false);
    expect(await sender.send("open", "test", "https://private.invalid/?apiKey=synthetic")).toBe(false);
  });
});

it("keeps one provider outage across Pacific days and sends one eventual recovery", async () => {
  const { store, sqlite } = await harness();
  const failure = { provider: "balldontlie" as const, observations: [], errors: ["http_error" as const], nextCursor: null, credits: null, retryAfterSeconds: null };
  await store.applyResult(failure, NOW);
  await store.applyResult(failure, later(NOW, 86_400_000));
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE transition='open'").get()?.n).toBe(1);
  await store.applyResult({ ...failure, errors: [] }, later(NOW, 2 * 86_400_000));
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE transition='recovery'").get()?.n).toBe(1);
});

it("times out email delivery without marking an unconfirmed send successful", async () => {
  vi.useFakeTimers();
  const sender = emailNotifications({ scope: "test", from: "beam@example.invalid", to: "owner@example.invalid", message: () => ({} as EmailMessage), binding: { send: () => new Promise(() => {}) } as unknown as SendEmail });
  const pending = sender.send("open", "test", "timeout:1");
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await pending).toBe(false);
});
