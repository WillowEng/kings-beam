# Milestone 2 operational behavior

Specification v2.1 is unchanged. All behavior described here is implemented and
locally tested with mock services. Nothing has been activated or deployed.

## Decision loop and recovery

`runOperations()` is shared by the gated scheduled handler and owner Run Now /
Connection Test controls. The proposed five-minute Cron remains absent from both
Wrangler configurations. `OPERATIONS_ENABLED` must also be explicitly set before
any runtime polling path can execute. Public reads never enter this code.

An expiring, token-checked D1 pipeline lease excludes overlapping scheduled/manual
runs. Requests reserve budget first; errors and timeouts remain charged. Each run
makes at most three primary requests in production or one in TEST; a connection
test makes at most one primary request. Responses have timeouts and byte limits.
A crashed run is recoverable after lease expiry; results and IDs remain idempotent.

Active-season discovery scans Pacific yesterday through tomorrow, covering UTC
adjacent dates. All five documented classification query types are tracked separately:
regular, playoffs, playin, preseason and ist. Each cursor persists; only the final
successful page completes its query. Invalid data/429 do not certify empty schedules.
Daily discovery is not a repeated upstream request on every no-game tick.

Persisted games initiate primary checks around 90 minutes after scheduled start
(at 30-minute intervals initially, then five-minute intervals after 150 minutes).
Known query provenance prevents unnecessary scans of other competitions. First primary
final detection refreshes the other daily classification scans once. Scores are checked
in one batched Odds scores request after a potential eligible final, with bounded
15/45/120-minute retries. Persisted starts also initiate bounded secondary checks
when primary results are unavailable. Backoff honors Retry-After plus deterministic
provider jitter. Reporting lag is not a score conflict.

Both providers must agree on a uniquely matched final with known eligibility/time
confidence before public dual verification is possible. Coverage additionally requires
all five completed primary queries, no unresolved current-day game/gap, a configured history
boundary and fresh secondary evidence. Deadlines use actual successful receipt times;
a no-request tick never refreshes evidence. Summer League has no invented query and
prevents complete automatic coverage if enabled without trustworthy reference evidence.
Unknown or unsupported competition coverage remains unverified. Live competition
coverage and lag are still deployment acceptance gates, not fixture-proven claims.

Recovery uses durable seven-day primary windows, all classification queries and all
pages before advancing. New outages extend/reopen checkpoints even after an older
recovery completed. Recent games get secondary attempts before the conservative
three-day start/history boundary. Older secondary gaps remain explicitly recorded;
recovery does not manufacture dual observations or re-light expired dates. A newer
unresolved recovery gap can make `last_win:null`; historical uncertainty does not
permanently prevent future current-day verification. Initial history is explicitly
unknown until an owner supplies a meaningful history boundary and backfill completes.

## Free-plan quota partitions

| Provider / purpose | Maximum allocation | Coordination |
| --- | ---: | --- |
| BALLDONTLIE production | 3 requests / rolling minute | Persistent reservations |
| BALLDONTLIE TEST | 1 request / rolling minute | Separate DB, disjoint partition |
| BALLDONTLIE outside diagnostics | 1 request / minute | Must be coordinated by operator |
| Odds production normal | 260 credits / explicit billing period | Production D1 |
| Odds TEST, including its diagnostics/recovery | 80 | TEST D1; no production reserves |
| Odds recovery | 75 | Production-only separate ledger |
| Odds diagnostics | 20 | Production-only separate ledger |
| Odds emergency | 15 | Current-day provisional victory checks when normal quota is blocked |
| Odds unallocated safety | 50 of advertised 500 | No application allocation |

Emergency credits cannot fund diagnostics or TEST; only a sound current-day provisional
victory can use them after its ordinary allocation fails. The 450-credit application soft limit is partitioned, not a shared writable TEST-to-prod
binding. Billing periods are **never inferred from the calendar**. A missing period
fails closed. Provider `x-requests-used`, `x-requests-remaining`, `x-requests-last`
and safe latency/outcome metadata are recorded; larger costs consume additional
allocation. TEST pauses before the shared reserve is threatened; production stops
before the 50-credit margin, based on the conservative available account headers.
Outside clients cannot be centrally counted: the owner must coordinate them and
confirm both environments use the same real account period. Entitlements and free
cycle remain unverified until owner-approved account checks. No paid fallback exists.

## Private owner controls

Default admin requests return 404. Enabling code requires complete Access issuer,
audience, owner allowlist and exact HTTPS admin origin, plus explicit activation.
JWT verification uses RS256 issuer JWKS, signature, issuer, audience, expiry, issued-at,
not-before and signed owner identity. Email headers alone grant no access; alternate
hosts/previews fail. Secret headers, keys and URLs never appear in the UI.

All private assets and APIs authenticate. Mutations require same Origin, JSON,
explicit confirmation, one-time subject-bound expiring CSRF nonce, command ID and
expected revision. Settings changes are atomic/audited; repeated commands do not
renew overrides. Spending actions are durably claimed and rate-limited, then share
the pipeline lease and budgets. CSRF/command errors are fixed, sanitized categories.
CSP disallows inline script, framing and third-party assets. Dynamic data uses
textContent, not HTML insertion; no private CORS is enabled.

The phone-friendly dashboard includes calculated status, next Pacific midnight,
seven eligibility switches/restore defaults, manual AUTO/ON/OFF, manual-only, strict
ON policy, provider enable/order, Run Now, per-provider connection tests, test email,
completion evidence resolution, incident acknowledgement and bounded history/diagnostics.
The effective mode and expired overrides still follow the core's request-time rules.

TEST has private status under `/admin/status.json`, a strong TEST label, separate
settings/D1/incidents/outbox and a selectable mapped team (OKC initially). A team
switch is blocked during an active pipeline lease, clears current coverage and
active override with an audit, and retains historical evidence. Core filters old-team
history. TEST-only pure scenarios display synthetic inputs, expectations, results and
actual PASS/FAIL without changing game evidence. TEST live polling is off by default.

## Monitoring and delivery

Healthchecks heartbeat uses a separately supplied secret check URL, only after durable
bookkeeping. A stopped/failing Worker withholds success, allowing the independent
external check to notify. Intentional off-season or paused TEST runs can heartbeat.
No check is configured here; absence of a real check cannot detect missing Cron yet.

Individual incident/recovery email uses the durable outbox with bounded retries and
stable delivery IDs. A separate optional **Cloudflare Email Routing send_email binding**
adapter sends to one configured, verified recipient; it does not use paid Email Service
builder APIs. Per-environment bindings/from/to are absent. Free Routing eligibility,
a suitable existing domain and actual delivery must be confirmed before activation.
The code does not create a domain, configure Routing or request payment.

Each incident generation creates one opening and one recovery transition; provider
outages retain a stable identity across Pacific days. Acknowledgement is distinct
from recovery. Each transition is sent individually, so recovery of one incident does
not conceal another. Delivery failures retry without marking delivered; a crash after
send but before persistence may repeat a message with the same ID. Exactly-once
email delivery is not promised. A separate test-email action uses the same private
recipient channel without changing incident or heartbeat state.

D1 write errors may prevent recording their own incident. They withhold heartbeat;
public reads fail sanitized 503 when dependable storage is unavailable. Public-serving
monitoring outside the Worker is not configured. Only transient nonces, expired leases
and old rolling-minute reservations are pruned; quota totals, observations, overrides,
incidents and audits remain intact. Production retention/backup sizing must be checked
before launch. No real email, monitoring request or sports call occurred during tests.
