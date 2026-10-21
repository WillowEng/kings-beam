import type { Transport } from "../providers/adapter";
import type { Scope } from "../core/models";
export type Signal = "heartbeat" | "open" | "recovery" | "test";
export interface Monitor { send(signal: Signal, scope: Scope, id: string): Promise<boolean> }
export interface MonitorSecrets { scope: Scope; heartbeat?: string; incidents?: string; test?: string }
/** Secret URLs never leave this module, including on errors; separate checks per environment and purpose. */
export function healthchecks(secrets: MonitorSecrets, transport: Transport): Monitor {
  function valid(value: string | undefined): URL | null {
    try {
      const u = new URL(value ?? "");
      return u.protocol === "https:" && u.hostname === "hc-ping.com" && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/[a-f0-9-]{36}$/.test(u.pathname) ? u : null;
    } catch { return null; }
  }
  return { async send(signal, scope, id) {
    if (scope !== secrets.scope || !["heartbeat", "test"].includes(signal)) return false;
    const values = [secrets.heartbeat, secrets.incidents, secrets.test].filter(Boolean);
    if (new Set(values).size !== values.length) return false;
    const u = valid(signal === "heartbeat" ? secrets.heartbeat : signal === "test" ? secrets.test : secrets.incidents);
    if (!u) return false;
    // Incident checks are asserted failed while any incident is open; heartbeat uses its own check.
    if (signal === "open" || signal === "test") u.pathname += "/fail";
    try {
      const r = await transport(u, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000), headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ scope, signal, delivery: id }) });
      return r.ok;
    } catch { return false; }
  } };
}
