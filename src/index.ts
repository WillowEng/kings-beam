import type { Env } from "./config";
import { Store } from "./data/db";
import { calculateStatus } from "./core/beam";
import { Operations } from "./operations/store";
import { adminRoutes } from "./admin/routes";
import { runOperations } from "./scheduled";
import { healthchecks } from "./monitoring/health";
import { emailNotifications } from "./monitoring/email";
import { deliverOutbox } from "./monitoring/alerts";
const closed = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
function resources(env: Env, at: string) {
  if (!env.DB || !["production", "test"].includes(env.APP_ENV)) throw new Error("database_unavailable");
  const store = new Store(env.DB, env.APP_ENV), ops = new Operations(store);
  // Only operational paths receive the runtime transport; public status never uses it.
  const transport: typeof fetch = (input, init) => fetch(input, init);
  const options = { at, transport, keys: { balldontlie: env.BALLDONTLIE_API_KEY ?? "", odds_api: env.ODDS_API_KEY ?? "" } };
  const monitor = emailNotifications({ scope: env.APP_ENV, from: env.EMAIL_FROM, to: env.EMAIL_TO, binding: env.NOTIFICATIONS_ENABLED === "true" ? env.EMAIL : undefined });
  return { store, ops, transport, options, monitor };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/admin" || path.startsWith("/admin/")) {
      if (env.ADMIN_ENABLED !== "true" || !env.DB) return closed();
      try {
        const { ops, transport, options, monitor } = resources(env, new Date().toISOString());
        // API calls additionally require explicit operations activation, even for authenticated diagnostics.
        if (request.method === "POST" && ["/admin/run", "/admin/connection"].includes(path) && env.OPERATIONS_ENABLED !== "true") return closed();
        return await adminRoutes(request, { enabled: env.ADMIN_ENABLED, issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUDIENCE, owners: env.ADMIN_OWNERS, origin: env.ADMIN_ORIGIN }, ops, transport, options, monitor);
      } catch { return closed(); }
    }
    if (request.method === "GET" && path === "/status.json" && env.APP_ENV === "production") {
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
      try {
        if (!env.DB) throw new Error("database_unavailable");
        const at = new Date().toISOString();
        return new Response(JSON.stringify(calculateStatus(await new Store(env.DB, "production").snapshot(at), at)), { status: 200, headers });
      } catch { return new Response(JSON.stringify({ error: "service_unavailable" }), { status: 503, headers }); }
    }
    return closed();
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.OPERATIONS_ENABLED !== "true") return;
    const at = new Date().toISOString();
    const { store, ops, options, monitor } = resources(env, at);
    try {
      const report = await runOperations(store, options);
      if (report.outcome === "busy") return;
      if (env.NOTIFICATIONS_ENABLED === "true") await deliverOutbox(ops, monitor, at);
      // Heartbeat only after durable bookkeeping; intentional paused/off-season ticks remain alive.
      await healthchecks({ scope: env.APP_ENV, heartbeat: env.HEALTHCHECKS_HEARTBEAT_URL }, options.transport).send("heartbeat", env.APP_ENV, at);
    } catch {
      // D1 failure may prevent its own incident write. Withhold heartbeat so the independent check alerts.
      try { await store.incident("runtime:bookkeeping", "database", null, true, at); } catch { /* No raw exception logging. */ }
      throw new Error("operational_run_failed");
    }
  },
} satisfies ExportedHandler<Env>;
