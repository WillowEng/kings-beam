import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, globSync } from "node:fs";
const newestSource = Math.max(...[...globSync("src/**/*.ts"), "wrangler.toml", "package-lock.json"].map(path => statSync(path).mtimeMs));
for (const scope of ["production", "test"]) {
  if (statSync(`dist/${scope}/index.js`).mtimeMs < newestSource) throw new Error("Runtime bundle is stale; run npm run build first");
}
mkdirSync(".wrangler", { recursive: true });
await build({ entryPoints: ["test/runtime/d1-smoke.ts"], outfile: ".wrangler/d1-smoke.mjs", bundle: true, platform: "node", format: "esm", packages: "external" });
const result = spawnSync(process.execPath, [".wrangler/d1-smoke.mjs"], {
  stdio: "inherit", env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false" },
});
process.exitCode = result.status ?? 1;
