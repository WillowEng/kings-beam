# kings-beam

Kings Beam API reports a calculated fan indicator, not the physical Beam's measured
state. [Specification v2.1](SPECIFICATION.md) defines the approved requirements.

## Current scope

Steps 2 and 3 provide a local TypeScript/Cloudflare Workers scaffold and test
foundation. The application has no Beam
calculation, eligibility rules, provider adapters, database bindings, scheduled
handler, active Cron triggers, authentication implementation, or remote services.
No application has been deployed.

- Local production `GET /status.json` returns HTTP 503 with
  `{"error":"not_initialized","message":"Beam status is not available in this scaffold."}`.
  It does not return fabricated Beam state.
- TEST status, admin paths, unknown routes, and unsupported methods return 404.
  TEST remains inaccessible until private access is implemented.
- All responses use `Cache-Control: no-store`. Public CORS is limited to the
  production status GET placeholder.

## Local setup and validation

Use Node.js 24 and npm. Install the exact locked dependency tree:

```sh
npm ci --ignore-scripts --no-audit
npm run check
```

Individual commands:

```sh
npm run typecheck
npm run build
npm test
```

`build` bundles both named environments using Wrangler `deploy --dry-run`; it
does not upload or deploy anything. Artifacts go to ignored `dist/production` and
`dist/test`. No deployment script is provided. npm's cache is kept in ignored
`.cache/npm`; Wrangler config/logs stay in ignored `.wrangler` and telemetry is
disabled in the scripts. Miniflare's optional remote `Request.cf` metadata fetch
is also disabled with `CLOUDFLARE_CF_FETCH_ENABLED=false`; the local runtime uses
placeholder metadata. Commands use POSIX shell environment assignments.

Tests run the handler with Node's Web APIs. Test setup blocks global `fetch` and
Node HTTP(S)/TCP/TLS access unless an explicit in-memory HTTP mock handles the
request. Unexpected access fails cleanup even if its immediate error was caught.
Clock/DST scenarios, sanitized provider fixtures, monitoring doubles, and
credential-output checks are described in [the testing guide](test/README.md).
These tests need no provider keys or live services. They do not yet validate D1,
Access, actual provider adapters, or a deployed Worker runtime.

## Local development

```sh
npm run dev
# Or exercise the production placeholder locally:
npm run dev:production
```

Both commands use Wrangler `--local`, bind only to `127.0.0.1`, and start no
background schedule. Stop the local server with Ctrl-C. Never use `--remote` for
this step.

## Configuration boundaries

`wrangler.toml` has separate `production` and `test` names and `APP_ENV` values.
The default environment is TEST. All environments have public workers.dev and
preview URLs disabled. There are no account/database identifiers, D1 bindings,
routes, service bindings, or Cron triggers. Missing or unexpected `APP_ENV` does
not expose a production status response.

`.dev.vars.example` contains nonfunctional placeholders for future use. It is not
loaded as a secret file; the scaffold needs no credentials. Do not populate real
credentials during this step. Local `.dev.vars` and environment variants are
ignored; Codex network secrets are not automatically Worker secrets.

## Structure

```text
src/
  index.ts             # fail-closed HTTP entry point
  config.ts            # environment type only
  core/                # reserved for business logic
  providers/           # reserved for the two approved adapters
  data/                # reserved for database access
  admin/               # reserved for private administration
  monitoring/          # reserved for heartbeat and incidents
test/
  README.md            # helper/fixture provenance and limitations
  setup.ts             # network and captured-console guards
  support/             # clock, HTTP, monitoring and diagnostics doubles
  unit/scaffold.test.ts
  unit/                # helper behavior tests
  fixtures/            # synthetic scenarios and reduced Stage A evidence
  integration/         # in-memory fixture/HTTP tests
  isolation/           # harness separation and credential-output tests
```

Reserved application directories are retained with `.gitkeep`; they contain no implementations.
No planning-conversation `PROJECT_HANDOFF.md` has been copied into the repository.

## Approval boundary

Further business logic, provider integrations, database migrations, and live tests
belong to later authorized steps. Commits/pushes, remote setup, real credentials,
Access activation, monitoring, Cron, and deployments require their respective
owner approvals. No paid features or trials are configured.
