# Milestone 1 local development and boundaries

## Commands and storage

Use the existing checkout on `work`. `npm ci --ignore-scripts --no-audit` installs
locked development tools; no application runtime packages are required.

- `npm run check`: strict type-check, production/TEST Wrangler dry runs, offline
  Vitest suites, then workerd/local-D1 smoke validation with Worker outbound denied.
- `npm run db:local:production` / `npm run db:local:test`: local migrations and
  idempotent initial identity/settings/team records. Scripts hardcode `--local`;
  there is no user-selectable remote mode or account identifier.
- `npm run dev:production` / `npm run dev`: loopback-only local Workers using
  `wrangler.local.toml`. TEST remains private/unavailable over HTTP.

Local D1 data and generated initialization SQL live under ignored `.wrangler`.
The two placeholder UUIDs in the local config are distinct and identify no actual
Cloudflare database. `wrangler.toml` retains no remote bindings/routes/Cron.
No `.dev.vars` file or real provider credentials are needed or created.

Schema changes are `0001_core.sql`, `0002_read_projection.sql`, and
`0003_evidence_revision.sql`. Migrations are
tracked by Wrangler and repeated setup does not reset existing settings/history.
Keep local data before experimenting with migrations: stop development, copy the
entire `.wrangler/state` directory to an ignored/private backup, and restore it
only with servers stopped. This directory-copy restore procedure is guidance,
not a verified production backup/restore plan. Do not use destructive down migrations
to undo observation history or manual decisions. Production operations remain gated.

## Internal core surfaces

`Store.initialize()` establishes immutable scope/team identity. Production is SAC;
TEST can initially select any known canonical team (OKC default). A swapped database
binding is rejected before writes. Settings and manual controls use expected revision
plus command IDs; stale commands fail and repeats cannot renew an expired override.
These are internal methods, not authenticated HTTP endpoints. A future admin layer
must supply verified owner identity and CSRF protections; this milestone exposes none.

`checkSources()` checks both enabled adapters in configured priority order with an
explicit mock/injected transport and explicit keys. It neither starts a timer nor
defaults to global fetch. The public Worker does not call it. A successful primary
does not skip the secondary; disabled sources make no request.

Adapters validate envelopes, lifecycle, identities, scores and timestamps. BDL
classification retains query provenance; Odds observations stay unclassified and
can use only classification previously attached to the matched canonical game.
Summer League has no invented BDL query: it needs per-game vetted reference evidence.
The registry contains canonical NBA names/BDL ID mappings and explicit aliases;
only the previously sampled Kings/Thunder identities were live-validated here.

Matching requires validated oriented teams, compatible season where available,
starts within 90 minutes and exactly one candidate. Provider IDs remain separate.
Existing IDs survive rescheduling, but identity changes create held incidents.
Unmatched observations are persisted and retried when primary discovery arrives.
All normalized observations are retained; duplicates are idempotent. A SQL trigger
maintains a compact read projection transactionally, preserving first-final,
last-nonfinal, classification facts and latest provider evidence. Evidence revisions reject stale incident updates
computed before a concurrent observation changed the game.

`recordCoverage()` is an internal **trusted completeness assertion**, not an inference
from an empty response. Its caller must establish all enabled categories, both
sources, current-day schedule coverage, finished pagination and unresolved gaps
before setting `complete:true`, with a freshness deadline no more than 26 hours after the check. `checkSources()`
deliberately does not certify coverage from its partial/page-limited lookup. Automatic
multi-query schedule discovery/recovery orchestration is not activated in Milestone 1.
Without that proof, even matching scores remain publicly unverified.

`resolveCompletion()` records explicit trusted completion evidence with an actor and
audit command; ordinary provider fields never populate actual completion time.
`setOverride()`, `updateSettings()` and `restoreDefaults()` persist audited controls.
Eligibility changes apply to cached same-day results immediately on the next read.

Incidents and opening/recovery outbox rows are durable and deduplicated. Delivery,
external heartbeat, dashboard, leases for scheduled orchestration and live recovery
jobs are later milestones; no email or monitoring service is contacted now.

## Quotas and provider privacy

Every adapter request reserves budget before sending. Missing period/cap configuration
fails closed. BDL production uses at most 3 requests per rolling minute; TEST uses 1,
leaving the fifth account-wide request for coordinated diagnostics. Both also require
an explicit minute-period allocation. Odds production is capped at 260 credits per
configured billing period, TEST at 80; remaining approved reserves are not automatically
spent by this milestone. Conservative reservations remain charged on errors/timeouts;
larger reported costs are added and prevent further spending when the cap is reached.

Supply the real verified Odds billing-cycle boundaries only in a later authorized
configuration step. The code does not guess a calendar-month reset or auto-upgrade.
External diagnostic callers must respect the unallocated reserve; a local database
cannot count arbitrary outside account usage. Header/account reconciliation and
scheduled retry/backoff planning still require later operational integration.

Requests time out, reject oversized bodies, and return only fixed error codes and
allowlisted quota metadata. They never return raw exception messages, auth headers,
or credential-bearing URLs. Unit/integration tests use synthetic credentials only.
The noncommercial public response remains a derived indicator, not a sports feed.

## Validation and remaining gates

Vitest uses real local SQLite for SQL integration and preserves the prior offline
guard/fixture tests. The separate runtime harness uses real workerd/D1, current
Wrangler bundles, isolated databases and denied Worker outbound; its only network
traffic is local Miniflare IPC/loopback. It checks migration compatibility, dual
status, scope separation and atomic rollback. Runtime test data is synthetic and
ephemeral, never an actual Kings result.

Live provider coverage/latency, a real Kings comparison, current licensing/account
entitlements, Access, Worker secrets, complete recovery operations and production
resource limits remain unverified or deferred as already documented in v2.1. No
Milestone 2/3 work, push, deployment, real migrations, Cron or external setup is
performed by these commands. Do not treat local success as launch authorization.
