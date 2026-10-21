import type { Env } from "./config";

/** Fail closed until state processing and authenticated administration exist. */
export default {
  fetch(request: Request, env: Env): Response {
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
      return new Response(
        JSON.stringify({
          error: "not_initialized",
          message: "Beam status is not available in this scaffold.",
        }),
        { status: 503, headers },
      );
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
