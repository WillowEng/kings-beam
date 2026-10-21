import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultSettings } from "../src/core/models.ts";
import { TEAMS } from "../src/core/teams.ts";
const scope = process.argv[2];
if (!["production", "test"].includes(scope) || process.argv.length !== 3) throw new Error("Choose production or test local database");
const env = { ...process.env, XDG_CONFIG_HOME: resolve(".wrangler/config"), CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: resolve(".wrangler/logs"), CI: "true" };
const common = ["DB", "--local", "--config", "wrangler.local.toml", "--env", scope];
function run(args) {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], { encoding: "utf8", env });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  console.log(`PASS: ${scope} local ${args[1]} (${result.stdout.includes("No migrations to apply") ? "already current" : "completed"})`);
}
run(["d1", "migrations", "apply", ...common]);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const statements = [
  `INSERT OR IGNORE INTO app_metadata(id,scope,team) VALUES(1,${quote(scope)},${quote(scope === "production" ? "SAC" : "OKC")});`,
  `INSERT OR IGNORE INTO settings(id,value) VALUES(1,${quote(JSON.stringify(defaultSettings()))});`,
  ...TEAMS.flatMap(t => [
    `INSERT OR IGNORE INTO teams(id,name) VALUES(${quote(t.id)},${quote(t.name)});`,
    `INSERT OR IGNORE INTO provider_team_ids(provider,provider_id,team) VALUES('balldontlie',${quote(t.bdlId)},${quote(t.id)});`,
    ...t.aliases.map(a => `INSERT OR IGNORE INTO team_aliases(alias,team) VALUES(${quote(a)},${quote(t.id)});`),
  ]),
];
mkdirSync(".wrangler", { recursive: true });
const file = `.wrangler/initialize-${scope}.sql`;
writeFileSync(file, statements.join("\n"));
run(["d1", "execute", ...common, "--file", file]);
