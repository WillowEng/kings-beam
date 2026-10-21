import type { Observation, Provider } from "../core/models";
import { instant } from "../core/time";
export type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ErrorCode = "http_error" | "rate_limited" | "invalid_response" | "invalid_record" | "timeout" | "network_error" | "budget_exhausted" | "disabled";
export interface AdapterResult { provider: Provider; observations: Observation[]; errors: ErrorCode[]; nextCursor: string | null; credits: number | null; retryAfterSeconds: number | null }
export function result(provider: Provider): AdapterResult { return { provider, observations: [], errors: [], nextCursor: null, credits: null, retryAfterSeconds: null }; }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_record");
  return value as Record<string, unknown>;
}
export function score(value: unknown, strings = false): number {
  if (strings && (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))) throw new Error("invalid_score");
  const n = strings ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error("invalid_score");
  return n;
}
export function optionalInstant(value: unknown): string | null { return value == null ? null : instant(value); }
export interface RequestBudget {
  reserve(provider: Provider, cost: number, at: string): Promise<boolean>;
  chargeExtra(provider: Provider, cost: number): Promise<void>;
}
/** Explicit transport and budget required; never defaults to global fetch. */
export async function requestJson(provider: Provider, url: URL, headers: Record<string, string>, transport: Transport, budget: RequestBudget, at: string, timeoutMs = 8_000): Promise<{ output: AdapterResult; body: unknown }> {
  const output = result(provider), reserved = provider === "odds_api" ? 2 : 1;
  if (!await budget.reserve(provider, reserved, instant(at))) { output.errors.push("budget_exhausted"); return { output, body: null }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let received = false;
  try {
    const response = await transport(url, { headers, signal: controller.signal, redirect: "error" });
    received = true;
    const cost = response.headers.get("x-requests-last");
    if (provider === "odds_api" && cost && /^\d+$/.test(cost)) {
      output.credits = Number(cost);
      if (output.credits > reserved) await budget.chargeExtra(provider, output.credits - reserved);
    }
    const retry = response.headers.get("Retry-After");
    if (retry && /^\d+$/.test(retry)) output.retryAfterSeconds = Math.min(Number(retry), 86_400);
    else if (retry && Number.isFinite(Date.parse(retry))) output.retryAfterSeconds = Math.min(86_400, Math.max(0, Math.ceil((Date.parse(retry) - Date.parse(at)) / 1_000)));
    if (!response.ok) { output.errors.push(response.status === 429 ? "rate_limited" : "http_error"); return { output, body: null }; }
    // Bound decoded bytes before parsing; never propagate upstream error text/URLs.
    if (!response.body) throw new Error("empty_body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "", length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2_000_000) { await reader.cancel(); throw new Error("large_body"); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    try { return { output, body: JSON.parse(text) as unknown }; }
    catch { output.errors.push("invalid_response"); return { output, body: null }; }
  } catch {
    output.errors.push(controller.signal.aborted ? "timeout" : received ? "invalid_response" : "network_error");
    return { output, body: null };
  } finally { clearTimeout(timer); }
}
