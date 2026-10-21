import type { Env } from "./config";
import { Store } from "./data/db";
import { calculateStatus } from "./core/beam";

/** Public reads never initialize storage, mutate state, or call providers. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };

    if (
      request.method === "GET" &&
      pathname === "/status.json" &&
      env.APP_ENV === "production"
    ) {
      headers["Access-Control-Allow-Origin"] = "*";
      try {
        if (!env.DB) throw new Error("database_unavailable");
        const at = new Date().toISOString();
        const snapshot = await new Store(env.DB, "production").snapshot(at);
        return new Response(JSON.stringify(calculateStatus(snapshot, at)), { status: 200, headers });
      } catch {
        return new Response(JSON.stringify({ error: "service_unavailable" }), { status: 503, headers });
      }
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
