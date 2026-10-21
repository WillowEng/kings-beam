import { simulations } from "../operations/simulations";
import type { AuthConfig } from "./auth";
import { authenticate, configured, hashNonce } from "./auth";
import { Operations, later } from "../operations/store";
import { calculateStatus } from "../core/beam";
import { nextPacificMidnight } from "../core/time";
import type { Settings, Provider, Override } from "../core/models";
import type { Transport } from "../providers/adapter";
import { runOperations, type RunOptions } from "../scheduled";
import type { Monitor } from "../monitoring/health";
import { dashboard, dashboardScript } from "./ui";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
export async function adminRoutes(request: Request, config: AuthConfig, ops: Operations, transport: Transport, options: RunOptions, monitor: Monitor): Promise<Response> {
  if (!configured(config)) return response({ error: "not_found" }, 404);
  let owner;
  try { owner = await authenticate(request, config, transport, options.at); }
  catch { return response({ error: "unauthorized" }, 403); }
  const pathname = new URL(request.url).pathname;
  try {
    if (request.method === "GET") {
      if (pathname === "/admin" || pathname === "/admin/") return new Response(dashboard(ops.store.scope), { headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
      if (pathname === "/admin/app.js") return new Response(dashboardScript, { headers: { ...HEADERS, "Content-Type": "text/javascript; charset=utf-8" } });
      if (pathname === "/admin/style.css") return new Response("body{font:16px system-ui;max-width:65rem;margin:auto;padding:1rem;background:#17101f;color:#fff}button,input,select{font:inherit;margin:.4rem;padding:.65rem}label{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border:1px solid #975ec9;padding:1rem;margin:1rem 0}", { headers: { ...HEADERS, "Content-Type": "text/css" } });
      if (pathname === "/admin/status.json") return response({ environment: ops.store.scope, label: ops.store.scope === "test" ? "TEST — DOES NOT AFFECT KINGS" : "PRODUCTION", status: calculateStatus(await ops.store.snapshot(options.at), options.at) });
      if (pathname === "/admin/state") {
        const nonce = crypto.randomUUID();
        await ops.store.settings();
        await ops.stmt("DELETE FROM csrf_nonces WHERE expires_at<=?", options.at).run();
        const existing = await ops.stmt("SELECT COUNT(*) AS n FROM csrf_nonces WHERE subject=? AND consumed_at IS NULL", owner.subject).first<{ n: number }>();
        if ((existing?.n ?? 0) >= 20) return response({ error: "too_many_sessions" }, 429);
        await ops.stmt("INSERT INTO csrf_nonces(hash,subject,expires_at) VALUES(?,?,?)", await hashNonce(nonce), owner.subject, later(options.at, 10 * 60_000)).run();
        const diagnostics = await ops.diagnostics(options.at);
        return response({ ...diagnostics, status: calculateStatus(diagnostics.snapshot, options.at), nextMidnight: nextPacificMidnight(options.at), configuration: await ops.store.settings(), csrf: nonce });
      }
      return response({ error: "not_found" }, 404);
    }
    if (request.method !== "POST" || !["/admin/settings", "/admin/defaults", "/admin/override", "/admin/operations", "/admin/run", "/admin/connection", "/admin/test-alert", "/admin/acknowledge", "/admin/completion", "/admin/simulations"].includes(pathname)) return response({ error: "not_found" }, 404);
    if (request.headers.get("Origin") !== new URL(config.origin!).origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json" || ["cross-site", "none"].includes(request.headers.get("Sec-Fetch-Site") ?? "")) return response({ error: "invalid_origin" }, 403);
    // Bound bytes before JSON parsing; never echo incoming exception/request details.
    const reader = request.body?.getReader();
    if (!reader) return response({ error: "invalid_request" }, 400);
    let size = 0, text = "", timedOut = false; const decoder = new TextDecoder();
    const timer = setTimeout(() => { timedOut = true; void reader.cancel(); }, 5_000);
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) { await reader.cancel(); return response({ error: "request_too_large" }, 413); } text += decoder.decode(part.value, { stream: true }); }
    } finally { clearTimeout(timer); }
    if (timedOut) return response({ error: "request_timeout" }, 408);
    const body = JSON.parse(text + decoder.decode()) as Record<string, unknown>;
    if (!body || body.confirm !== true || typeof body.command !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(body.command) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return response({ error: "invalid_command" }, 400);
    const csrf = request.headers.get("X-CSRF-Token");
    if (!csrf || !/^[a-f0-9-]{36}$/.test(csrf)) return response({ error: "invalid_csrf" }, 403);
    const consumed = await ops.stmt("UPDATE csrf_nonces SET consumed_at=? WHERE hash=? AND subject=? AND expires_at>? AND consumed_at IS NULL", options.at, await hashNonce(csrf), owner.subject, options.at).run();
    if (consumed.meta.changes !== 1) return response({ error: "invalid_csrf" }, 403);
    if (pathname === "/admin/settings") await ops.store.updateSettings(body.value as Settings, Number(body.revision), body.command, owner.actor, options.at);
    if (pathname === "/admin/defaults") await ops.store.restoreDefaults(Number(body.revision), body.command, owner.actor, options.at);
    if (pathname === "/admin/override") await ops.store.setOverride(body.mode as Override["mode"], Number(body.revision), body.command, owner.actor, options.at);
    if (pathname === "/admin/operations") await ops.configure(body.value as import("../operations/store").OperationalSettings, Number(body.revision), body.command, owner.actor, options.at, body.team as string | undefined);
    if (pathname === "/admin/completion") {
      if ((await ops.store.settings()).revision !== body.revision) return response({ error: "revision_conflict" }, 409);
      await ops.store.resolveCompletion(String(body.game), String(body.completedAt), owner.actor, body.command, options.at);
    }
    if (pathname === "/admin/simulations" && ops.store.scope !== "test") return response({ error: "not_found" }, 404);
    if (["/admin/run", "/admin/connection", "/admin/test-alert", "/admin/acknowledge", "/admin/simulations"].includes(pathname)) {
      const expected = await ops.store.settings();
      if (body.revision !== expected.revision) return response({ error: "revision_conflict" }, 409);
      const old = await ops.stmt("SELECT action,actor,outcome FROM admin_commands WHERE id=?", body.command).first<{ action: string; actor: string; outcome: string }>();
      if (old) return old.action === pathname && old.actor === owner.actor ? response({ outcome: old.outcome }) : response({ error: "command_conflict" }, 409);
      // Durable command claim plus global pipeline lease prevent overlapping clicks and duplicate spending.
      const recent = await ops.stmt("SELECT id FROM admin_commands WHERE at>? AND action IN ('/admin/run','/admin/connection','/admin/test-alert') LIMIT 1", later(options.at, -60_000)).first();
      if (recent && pathname !== "/admin/acknowledge") return response({ error: "rate_limited" }, 429);
      if (pathname === "/admin/connection" && !["balldontlie", "odds_api"].includes(String(body.provider))) return response({ error: "invalid_provider" }, 400);
      const claim = await ops.stmt("INSERT OR IGNORE INTO admin_commands(id,action,actor,at,outcome) SELECT ?,?,?,?,'pending' WHERE NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?) AND (?='/admin/acknowledge' OR NOT EXISTS(SELECT 1 FROM admin_commands WHERE at>? AND action IN ('/admin/run','/admin/connection','/admin/test-alert')))", body.command, pathname, owner.actor, options.at, body.command, pathname, later(options.at, -60_000)).run();
      if (claim.meta.changes !== 1) return response({ error: "command_conflict" }, 409);
      let outcome: unknown = "complete";
      if (pathname === "/admin/run" || pathname === "/admin/connection") outcome = await runOperations(ops.store, { ...options, diagnostic: true, ...(pathname === "/admin/connection" ? { provider: body.provider as Provider } : {}) });
      if (pathname === "/admin/simulations") outcome = simulations();
      if (pathname === "/admin/test-alert") outcome = await monitor.send("test", ops.store.scope, body.command) ? "sent" : "not_delivered";
      if (pathname === "/admin/acknowledge") await ops.stmt("UPDATE incidents SET acknowledged_at=?,acknowledged_by=? WHERE key=?", options.at, owner.actor, String(body.incident)).run();
      const serialized = JSON.stringify(outcome);
      await ops.store.db.batch([
        ops.stmt("UPDATE admin_commands SET outcome=? WHERE id=?", serialized, body.command),
        ops.stmt("INSERT INTO audit_log(id,action,actor,at,detail) VALUES(?,?,?,?,?)", body.command, pathname.slice(7), owner.actor, options.at, serialized),
      ]);
      return response({ outcome });
    }
    return response({ outcome: "complete" });
  } catch (error) {
    if (error instanceof Error && error.message === "settings_conflict") return response({ error: "revision_conflict" }, 409);
    return response({ error: "action_failed" }, 400);
  }
}
