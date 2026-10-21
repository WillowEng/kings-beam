import { beforeAll, describe, expect, it } from "vitest";
import { authenticate, configured } from "../../src/admin/auth";
import { signingFixture, authConfig } from "../support/auth";
import { NOW } from "../support/domain";
let fixture: Awaited<ReturnType<typeof signingFixture>>;
beforeAll(async () => { fixture = await signingFixture(); });
const req = (token: string, url = "https://admin.example.invalid/admin") => new Request(url, { headers: { "Cf-Access-Jwt-Assertion": token } });
describe("server-side Access authorization", () => {
  it("validates a real ephemeral RS256 signature and owner", async () => {
    const owner = await authenticate(req(await fixture.token()), authConfig, fixture.transport, NOW);
    expect(owner.actor).toBe("synthetic-owner");
  });
  it.each([{}, { exp: 1 }, { iat: 9999999999 }, { nbf: 9999999999 }, { email: "attacker@example.invalid" }, { iss: "https://evil.invalid" }, { aud: ["wrong"] }, { sub: "line\nbreak" }, { exp: "tomorrow" }, { iat: 0 }])("rejects invalid/missing claims %j", async changes => {
    const token = Object.keys(changes).length ? await fixture.token(changes) : "not-a-jwt";
    await expect(authenticate(req(token), authConfig, fixture.transport, NOW)).rejects.toThrow("unauthorized");
  });
  it.each([{ alg: "none" }, { alg: "HS256" }, { kid: "absent" }, { jku: "https://evil.invalid" }, { crit: ["unknown"] }])("rejects algorithm/key substitution %j", async header => {
    await expect(authenticate(req(await fixture.token({}, header)), authConfig, fixture.transport, NOW)).rejects.toThrow("unauthorized");
  });
  it("rejects tampering and trusted header impersonation", async () => {
    const token = await fixture.token();
    await expect(authenticate(req(token.slice(0, -10) + "invalidsig"), authConfig, fixture.transport, NOW)).rejects.toThrow("unauthorized");
    await expect(authenticate(new Request("https://admin.example.invalid/admin", { headers: { "Cf-Access-Authenticated-User-Email": "owner@example.invalid" } }), authConfig, fixture.transport, NOW)).rejects.toThrow("unauthorized");
  });
  it.each(["https://preview.example.invalid/admin", "https://beam.workers.dev/admin", "https://attacker.invalid/admin", "http://admin.example.invalid/admin"])("rejects hostname/preview bypass %s", async url => {
    await expect(authenticate(req(await fixture.token(), url), authConfig, fixture.transport, NOW)).rejects.toThrow("unauthorized");
  });
  it.each([{ enabled: "false" }, { issuer: "https://evil.invalid/" }, { owners: "" }, { audience: "" }, { origin: "http://admin.example.invalid/" }, { origin: "https://admin.example.invalid/path" }])("fails closed for incomplete config %j", changes => {
    expect(configured({ ...authConfig, ...changes })).toBe(false);
  });
  it("fails closed on unavailable/malformed JWKS without echoing its error", async () => {
    await expect(authenticate(req(await fixture.token()), authConfig, async () => { throw new Error("synthetic-private-diagnostic"); }, NOW)).rejects.toThrow(/^unauthorized$/);
    await expect(authenticate(req(await fixture.token()), authConfig, async () => Response.json({ keys: [] }), NOW)).rejects.toThrow("unauthorized");
  });
});
