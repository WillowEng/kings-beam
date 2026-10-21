# Local development and boundaries

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
`0003_evidence_revision.sql`, and `0004_operations.sql`. Migrations are
tracked by Wrangler and repeated setup does not reset existing settings/history.
Keep local data before experimenting with migrations: stop development, copy the
entire `.wrangler/state` directory to an ignored/private backup, and restore it
only with servers stopped. This directory-copy restore procedure is guidance,
not a verified production backup/restore plan. Do not use destructive down migrations
to undo observation history or manual decisions. Production operations remain gated.

## Internal core surfaces

`Store.initialize()` establishes immutable scope/team identity. Production is SAC;
TEST starts at OKC and can select a known canonical team through protected owner controls. A swapped database
binding is rejected before writes. Settings and manual controls use expected revision
plus command IDs; stale commands fail and repeats cannot renew an expired override.
The gated admin layer supplies verified owner identity, origin/CSRF controls,
confirmation and revision/idempotency guards. It remains inactive by default.

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
deliberately does not certify coverage from its partial/page-limited lookup. `runOperations()` now supplies multi-query/pagination receipts with short freshness
windows and explicit recovery gaps, but operational activation remains disabled.
Without that proof, even matching scores remain publicly unverified.

`resolveCompletion()` records explicit trusted completion evidence with an actor and
audit command; ordinary provider fields never populate actual completion time.
`setOverride()`, `updateSettings()` and `restoreDefaults()` persist audited controls.
Eligibility changes apply to cached same-day results immediately on the next read.

Incidents and opening/recovery outbox rows are durable and deduplicated. Milestone 2
implements leases, bounded delivery retries, heartbeat, recovery and protected controls.
All delivery is mocked in validation; no email or monitoring service is contacted.

## Quotas and provider privacy

Every adapter request reserves budget before sending. Missing period/cap configuration
fails closed. BDL production uses at most 3 requests per rolling minute; TEST uses 1,
leaving the fifth account-wide request for coordinated diagnostics. Both also require
an explicit minute-period allocation. Odds production is capped at 260 credits per
configured billing period, TEST at 80; production-only recovery/diagnostic/emergency reserves are partitioned separately
at 75/20/15 credits. They share the explicitly configured production billing period. Conservative reservations remain charged on errors/timeouts;
larger reported costs are added and prevent further spending when the cap is reached.

Supply the real verified Odds billing-cycle boundaries only in a later authorized
configuration step. The code does not guess a calendar-month reset or auto-upgrade.
External diagnostic callers must respect the unallocated reserve; a local database
cannot count arbitrary outside account usage. Header reconciliation and scheduled retry/backoff now reduce polling or pause TEST
when account usage approaches the free-plan safety margin.

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
entitlements, Access, Worker secrets, real notification delivery and production
resource limits remain unverified or deferred as already documented in v2.1. No
push, deployment, remote migration, Cron activation or external setup is
performed by these commands. [Operational details](operations.md) describe the
implemented code and remaining activation gates. Do not treat local success as launch authorization.
