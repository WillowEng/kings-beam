import { type AuthConfig } from "../../src/admin/auth";
import { type Transport } from "../../src/providers/adapter";
import { NOW } from "./domain";
export const authConfig: AuthConfig = { enabled: "true", issuer: "https://synthetic-beam.cloudflareaccess.com/", audience: "synthetic-audience-do-not-use", owners: "owner@example.invalid", origin: "https://admin.example.invalid/" };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const part = (v: unknown) => encode(new TextEncoder().encode(JSON.stringify(v)));
/** Ephemeral test-only signing keys: generated in memory, never persisted. */
export async function signingFixture() {
  const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = { ...await crypto.subtle.exportKey("jwk", key.publicKey), kid: "synthetic-key", alg: "RS256", use: "sig" };
  const now = Math.floor(Date.parse(NOW) / 1_000);
  const claims = { iss: new URL(authConfig.issuer!).origin, aud: [authConfig.audience], sub: "synthetic-owner", email: "owner@example.invalid", iat: now - 60, exp: now + 3_600 };
  return { jwk, claims,
    async token(changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
      const unsigned = part({ alg: "RS256", kid: jwk.kid, ...header }) + "." + part({ ...claims, ...changes });
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(unsigned));
      return unsigned + "." + encode(new Uint8Array(signature));
    },
    transport: (async input => {
      if (new URL(String(input)).href !== authConfig.issuer + "cdn-cgi/access/certs") throw new Error("Unexpected synthetic auth request");
      return Response.json({ keys: [jwk] });
    }) as Transport,
  };
}
