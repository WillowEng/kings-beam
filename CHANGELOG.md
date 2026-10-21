# Changelog

## Milestone 2 — Reliability and Controls (local, inactive)

- Added durable scheduled decisions, cursor/interval recovery, expiring leases,
  source backoff, quota reserve partitions and provider credit-header reconciliation.
- Added closed-by-default owner dashboard, signed Access JWT/owner checks, exact host,
  origin/CSRF/confirmation controls, audited settings and rate-limited diagnostic commands.
- Added isolated TEST team controls and pure synthetic PASS/FAIL scenarios; preserved
  current-day verification scope and withheld historical last_win across newer gaps.
- Added independent heartbeat and retrying incident/recovery email outbox adapters,
  with optional inactive free Email Routing binding; no account changes or real sends.
- Added offline security/reliability regressions and operational/security/runbook docs.
  Specification v2.1 and both Wrangler configurations remain unchanged. Activation,
  deployment and pushing this milestone still require explicit owner approval.

## Unreleased — Milestone 1 working local Beam API

- Implemented validated BDL/Odds adapters with injected transports, timeout/body bounds, secret-safe errors, explicit budgets and independent source checks. No live requests were made.
- Added seven exclusive eligibility categories, persisted/revisioned settings, canonical game matching, classification provenance, provisional/dual publication and disputed-support withdrawal.
- Added Pacific/DST expiration, uncertain completion dates, audited completion resolution, overrides/AUTO/manual-only and freshness-aware public JSON.
- Added three versioned local D1 migrations, scope checks, normalized observation/audit history, compact transactional read projection, incident/outbox transitions and conservative quota enforcement.
- Added offline core/provider/SQL integration tests and an actual workerd/local-D1 harness; local production/TEST migration and initialization commands are repeatable. Admin/TEST HTTP remain closed; no Cron is activated.
- Documented the public JSON contract, local operations, scope/security boundaries and remaining live/operational validation gates. Specification v2.1 is unchanged; no planning handoff was added.

## Unreleased — Step 3 automated testing foundation

- Added fixed UTC clocks, Pacific midnight/DST scenarios and timer cleanup without Beam-expiration logic.
- Added clearly labeled synthetic provider fixtures and separate reduced reconstructions of prior Stage A evidence; no live API tests were repeated.
- Added in-memory HTTP, abort/timeout and monitoring delivery doubles, plus per-environment harness-isolation tests.
- Extended network blocking to Node HTTP(S)/TCP/TLS entry points and fail-on-cleanup tracking. Added captured-console leak checks and a test-only allowlisted diagnostic recorder using synthetic credentials.
- Added Node.js 24 type declarations for the test utilities. Preserved the seven Step 2 scaffold tests and left all application source, Wrangler configuration and approved requirements unchanged.

## Unreleased — Step 2 local scaffolding

- Added a strict TypeScript Worker entry point, Wrangler configuration, locked development dependencies, and Vitest tests with global HTTP fetch blocked.
- Added separate production/TEST configuration structures without remote bindings, Cron triggers, or exposed admin routes. Production status is an explicit unavailable error; TEST status remains inaccessible.
- Reserved core, providers, data, admin, monitoring, fixture, integration, and isolation directories without implementing those features.
- Documented local installation, type-checking, dry-run builds, tests, configuration boundaries, and placeholder-only secret examples. Added an ignored project-local npm cache.
- No approved specification requirements were changed. No planning-conversation handoff was added.

## v2.1 — 2026-10-21

- Added `SPECIFICATION.md` from the authoritative v2.1 specification, superseding v2.0. Preserved its requirements and recorded the two owner-approved clarifications below in the relevant sections.
- Clarified category precedence: each game belongs to one exclusive eligibility category. NBA Cup regular-season games use `cup_regular`, independently of the general regular-season switch.
- Clarified verification scope: historical single-source or unverified games must not permanently block future verification. Unresolved games that could affect the current Pacific day's Beam state reduce current verification confidence.
- Added credential, local environment, secret-file, and generated-output exclusions in `.gitignore`, with exceptions for placeholder-only environment examples.
- Documentation inconsistency flagged: v2.1 references `PROJECT_HANDOFF.md` in its suggested layout and implementation instructions. The owner has directed that the planning-conversation handoff not be copied into this repository. No handoff file was added; a separate implementation handoff may be considered later. The specification's existing handoff references remain unchanged.
- Scope: local documentation setup only; no application scaffolding, commits, pushes, deployment, external configuration, or live API tests.
