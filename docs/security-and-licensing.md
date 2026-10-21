# Security, secrets and licensing gates

Specification v2.1 remains unchanged. Milestone 2 is a local implementation using
synthetic responses and ephemeral signing keys, not proof of live API access or deployed
security. No production account, remote D1, Cron, Access or monitoring setting changed.

## Runtime inventory (all optional activation values absent)

| Name | Purpose / handling |
| --- | --- |
| APP_ENV / DB | Fixed scope and a distinct D1 per Worker; checked against persisted identity |
| OPERATIONS_ENABLED | Closed unless exactly true; does not configure a Cron |
| ADMIN_ENABLED | Closed unless exactly true and complete validated authentication config |
| ACCESS_ISSUER / ACCESS_AUDIENCE | Expected Access team issuer and application audience |
| ADMIN_ORIGIN / ADMIN_OWNERS | Exact private HTTPS host and signed owner email allowlist; never public |
| BALLDONTLIE_API_KEY / ODDS_API_KEY | Separate Worker secrets, not Codex network secrets; never committed |
| HEALTHCHECKS_HEARTBEAT_URL | Secret per-environment heartbeat URL; never logged or shown |
| NOTIFICATIONS_ENABLED / EMAIL | Closed activation flag and optional separate Email Routing binding |
| EMAIL_FROM / EMAIL_TO | Private verified sender/recipient configuration, absent from source |

No real values belong in `.dev.vars.example`. Local tests need none. Environment files,
local databases, generated outputs and secrets are ignored. Never log request objects,
raw provider errors, keys, JWTs, authenticated Odds URLs or Healthchecks URLs. Adapters
strip unknown response fields, reject credential echoes and return fixed diagnostics.
Public JSON contains derived Beam metadata only. No scores/schedules/history feed is
public. Private diagnostics require authenticated ownership on every asset and API.

The admin rejects unsigned tokens, wrong algorithms/issuer/audience/owner, expired or
not-yet-valid tokens, tampering and hostname bypass. JWKS is fetched only from configured
Cloudflare Access issuer with bounded body/timeout, not token-provided URLs. Origin,
JSON, confirmation, one-time CSRF, revisions and durable command claims protect mutations.
Rate caps and shared pipeline leases apply even to authenticated requests. Static UI
uses CSP, no inline script, no third-party assets and escaped/text-only dynamic content.

TEST receives no production DB, writable service binding or admin token. Disjoint quota
allocations coordinate shared provider accounts without a cross-environment write path.
The deployment owner must verify actual bindings, sender recipients and host routes;
local mocks alone cannot prove the eventual account configuration.

## What remains before launch

Provider terms assessments in v2.1 remain prior Stage A assessments, not legal clearance.
No new sports calls or provider credits were used here. Current licensing must be reviewed
again before any deployment: noncommercial use, derived-only indicator, no competing feed,
no monetization or official affiliation, no unlicensed NBA/Kings logos or art. No ESPN,
API-Sports, betting/odds/bookmaker endpoints or webhooks were introduced.

Free service entitlements, actual Odds renewal period, live Kings/category coverage,
real Access enforcement, Email Routing eligibility, Heartbeat email/recovery and platform
resource consumption still require owner-approved activation validation. Nothing silently
falls back to a paid plan. If free email routing needs a domain the owner does not already
have, that is a decision before activation; no domain purchase is assumed or authorized.
