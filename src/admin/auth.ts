import type { Transport } from "../providers/adapter";
export interface AuthConfig { enabled?: string; issuer?: string; audience?: string; owners?: string; origin?: string }
export interface Owner { subject: string; actor: string; expires: number }
export class AuthError extends Error { constructor() { super("unauthorized"); } }
const decode = (part: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new AuthError();
  const data = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(data, c => c.charCodeAt(0));
};
const jsonPart = (part: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthError();
  return value as Record<string, unknown>;
};
export function configured(config: AuthConfig): boolean {
  try {
    const issuer = new URL(config.issuer ?? ""), origin = new URL(config.origin ?? "");
    return config.enabled === "true" && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.origin) && issuer.href === issuer.origin + "/" &&
      origin.protocol === "https:" && origin.href === origin.origin + "/" && Boolean(config.audience?.match(/^[a-zA-Z0-9_-]{16,200}$/)) &&
      Boolean(config.owners?.split(",").length) && config.owners!.split(",").every(email => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email));
  } catch { return false; }
}
/** Signature verification always uses configured issuer keys, never token-provided jku/x5u. */
export async function authenticate(request: Request, config: AuthConfig, transport: Transport, at: string): Promise<Owner> {
  try {
    if (!configured(config) || new URL(request.url).origin !== new URL(config.origin!).origin) throw new AuthError();
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token || token.length > 16_384 || token.split(".").length !== 3) throw new AuthError();
    const [headerPart, payloadPart, signature] = token.split(".");
    const header = jsonPart(headerPart), payload = jsonPart(payloadPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 200 || header.crit !== undefined || header.jku !== undefined || header.x5u !== undefined) throw new AuthError();
    const now = Math.floor(Date.parse(at) / 1_000);
    const issuer = new URL(config.issuer!).origin;
    if (payload.iss !== issuer || !Array.isArray(payload.aud) || !payload.aud.includes(config.audience) ||
      typeof payload.exp !== "number" || !Number.isInteger(payload.exp) || payload.exp <= now ||
      typeof payload.iat !== "number" || !Number.isInteger(payload.iat) || payload.iat > now + 30 || payload.exp <= payload.iat || payload.exp - payload.iat > 86_400 ||
      (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > now)) ||
      typeof payload.sub !== "string" || !/^[A-Za-z0-9_.:@-]{1,180}$/.test(payload.sub) ||
      typeof payload.email !== "string" || !config.owners!.split(",").map(e => e.toLowerCase()).includes(payload.email.toLowerCase())) throw new AuthError();
    const response = await transport(new URL(issuer + "/cdn-cgi/access/certs"), { redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (!response.ok || Number(response.headers.get("Content-Length") ?? 0) > 100_000) throw new AuthError();
    const reader = response.body?.getReader();
    if (!reader) throw new AuthError();
    let body = "", bytes = 0; const decoder = new TextDecoder();
    for (;;) { const p = await reader.read(); if (p.done) break; bytes += p.value.byteLength; if (bytes > 100_000) { await reader.cancel(); throw new AuthError(); } body += decoder.decode(p.value, { stream: true }); }
    body += decoder.decode();
    const keys = JSON.parse(body) as { keys: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }> };
    if (!Array.isArray(keys.keys) || keys.keys.length > 20) throw new AuthError();
    const candidates = keys.keys.filter(k => k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256") && (!k.use || k.use === "sig"));
    if (candidates.length !== 1) throw new AuthError();
    const key = await crypto.subtle.importKey("jwk", candidates[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signature), new TextEncoder().encode(headerPart + "." + payloadPart))) throw new AuthError();
    return { subject: payload.sub, actor: payload.sub, expires: payload.exp };
  } catch { throw new AuthError(); }
}
export async function hashNonce(nonce: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)))].map(n => n.toString(16).padStart(2, "0")).join("");
}
