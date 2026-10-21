# kings-beam

A calculated Sacramento Kings fan indicator, not a sensor for the physical Beam.
[Specification v2.1](SPECIFICATION.md) remains authoritative. Milestones 1 and 2 implement
and test the core and operational controls locally; no application has been deployed.

## Local setup

Use Node.js 24 and npm. No credentials are needed.

```sh
npm ci --ignore-scripts --no-audit
npm run check
npm run db:local:production
npm run db:local:test
npm run dev:production
```

The database commands apply versioned migrations and initialize **local-only**
identity/settings/team data. They are repeatable and contain no remote mode.
Development binds to loopback. Production-shaped reads use the local production
D1; `npm run dev` selects the separate, private TEST configuration. Stop with Ctrl-C.

`npm run check` runs TypeScript checking, two Wrangler `deploy --dry-run` builds,
Vitest, and an actual workerd/local-D1 smoke test. Dry runs do not deploy or upload.
Standalone commands are `npm run typecheck`, `npm run build`, `npm test`, and
`npm run test:runtime` (requires fresh builds). The runtime test rejects stale bundles.

## Implemented core

- Runtime-validated BALLDONTLIE and Odds scores adapters with explicitly injected
  transports, bounded response bodies/timeouts, safe errors and required budgets.
  Runtime transport is available only behind explicit operational/authentication gates;
  no real keys or services are configured.
- Seven exclusive eligibility categories and independent persisted switches, defaults,
  source enable/priority settings, strict/provisional policy and optimistic revisions.
- Canonical team aliases/game mappings, cached classification provenance, provisional
  publication, dual score agreement and disputed-support withdrawal.
- Pacific midnight/DST, conservative completion-date bounds, recorded completion
  resolution, manual overrides, AUTO and persistent manual-only state.
- Local D1 schema, append-only observations/audits, compact transactional read
  projection, coverage/failure records, incident/outbox transitions and quota counters.
- Public `GET /status.json`: stored data only, no upstream calls or writes. Missing
  D1/schema/identity returns sanitized 503; initialized empty history returns honest
  OFF/unverified/null history. See [the JSON contract](docs/public-api.md).

Milestone 2 adds durable scheduled decision-making, bounded recovery, quota partitions,
private owner controls, signed Access JWT validation, CSRF, audit, TEST simulations,
heartbeat and notification outbox delivery. **Admin and operational activation flags
are absent**, so admin and TEST HTTP status remain 404 in both committed configurations.
A scheduled handler exists, but no Cron triggers are configured. See
[operational behavior](docs/operations.md) and [the runbook](docs/runbook.md).

## Layout

```text
src/
  index.ts, config.ts, scheduled.ts
  core/          # models, eligibility, matching, reconciliation, clock, Beam, checks
  providers/     # validated adapters and bounded injected requests
  data/db.ts     # scope-checked D1 persistence and internal commands
  admin/         # gated owner dashboard, Access validation and CSRF controls
  operations/    # durable scans, recovery, quotas, leases and pure TEST scenarios
  monitoring/    # optional heartbeat/email adapters and durable outbox delivery
migrations/      # versioned local schema and transactional read projection
scripts/         # local-only DB setup and runtime smoke-test runner
wrangler.toml    # no remote bindings, routes or triggers
wrangler.local.toml # separate local D1 placeholder identifiers
test/           # fixtures, helpers, unit/integration/isolation/runtime checks
docs/           # JSON contract and local operations/limitations
```

Read [local development and boundaries](docs/local-development.md) and
[the testing guide](test/README.md). No planning-conversation handoff was copied.

## Secrets and approval boundary

The example secret file contains placeholders only. Actual environment files,
cache, `.wrangler`, dependencies and build outputs are ignored. Provider URLs with
query credentials must never be logged; adapters return fixed error categories,
not raw transport exceptions. Public responses expose no scores, raw feeds or identities.

Validation uses mocked providers, in-memory notifications, ephemeral JWT signing keys
and local databases only. Actual provider latency/competition coverage, billing-cycle
entitlements, Access host protection, current licensing, free email-routing eligibility
and remote setup remain activation gates. See [security and licensing](docs/security-and-licensing.md).
No deployment, external account change, paid feature, push or subsequent milestone
is authorized by these development commands.
