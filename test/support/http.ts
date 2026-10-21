import { unexpectedNetwork } from "./network";

export type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type HttpOutcome =
  | { kind: "json"; body: unknown; status?: number; headers?: Record<string, string> }
  | { kind: "network-error" }
  | { kind: "timeout" };
export interface HttpStep {
  origin: string;
  pathname: string;
  method?: string;
  outcome: HttpOutcome;
}

/** Ordered in-memory responses; never delegates to any real HTTP transport. */
export function createMockHttp(steps: readonly HttpStep[], onUnexpected = unexpectedNetwork) {
  let index = 0;
  const calls: Array<{ step: number; method: string }> = [];
  const fetch: TestFetch = async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); }
    catch { throw new Error("Invalid mock HTTP request"); }
    const url = new URL(request.url);
    const step = steps[index];
    if (!step || url.origin !== step.origin || url.pathname !== step.pathname || request.method !== (step.method ?? "GET")) {
      return onUnexpected();
    }
    calls.push({ step: index++, method: request.method });
    const outcome = step.outcome;
    if (outcome.kind === "network-error") throw new TypeError("Synthetic transport failure");
    if (outcome.kind === "timeout") {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Synthetic request aborted", "AbortError"));
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });
      });
    }
    return new Response(JSON.stringify(outcome.body), {
      status: outcome.status ?? 200,
      headers: { "Content-Type": "application/json", ...outcome.headers },
    });
  };
  return {
    fetch,
    calls,
    assertConsumed(): void {
      if (index !== steps.length) throw new Error("Expected mock HTTP steps were not consumed");
    },
  };
}

/** Test helper for exercising abortable requests with fake timers. */
export async function fetchWithTestTimeout(fetch: TestFetch, input: string, milliseconds: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(input, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
