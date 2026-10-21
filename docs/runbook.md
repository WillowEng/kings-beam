# Operations runbook and deployment pause

This is local implementation guidance, not authorization to activate services.
`npm run check` exercises type-checks, both dry-run bundles, offline tests and isolated
workerd/D1. `npm run db:local:production` and `npm run db:local:test` apply migrations
only to separate local placeholder databases. Do not substitute remote options.

## Diagnosing without spending credits

Start with protected state/history: scope/team, last completed job, scan cursors,
recovery boundary, game matching/classification/timing, provider outcome/backoff,
quota period/counters, incidents and outbox attempts. Public status reads are safe,
read-only and never call providers. A healthy HTTP 200 can still be unverified.

- **Cron stopped:** the external heartbeat must alert independently once configured.
  Resuming the decision loop backfills durable intervals. Do not mark old Odds results
  dual if their secondary window expired. Freshness expires without Cron.
- **Provider 429/outage/schema error:** leave observations intact, respect backoff,
  inspect fixed outcomes. Connection Test and Run Now consume budgets and cannot
  bypass limits. A scheduled/nonfinal secondary result is ordinary lag.
- **Conflicting scores:** inspect matched IDs and evidence; disputed sole support is
  withdrawn automatically. Preserve other valid wins and manual override. Do not delete
  observations to force agreement. Owner override expires at Pacific midnight.
- **Unknown competition or uncertain midnight:** keep unverified, inspect provenance
  and bounds. Record a completion timestamp only with trustworthy independent evidence
  and a confirmed, audited owner action. Never substitute last_updated or tipoff for end.
- **Quota blocked:** confirm account period and outside usage privately. There is no
  auto-renewal or paid fallback. Do not edit used totals, borrow TEST/production reserves,
  or increase approved caps to make a check pass. TEST may be paused intentionally.
- **Email not delivered:** review outbox attempts/next_at and binding configuration
  privately; retry with the existing durable ID. Test Alert Email is rate-limited and
  does not recover incidents or heartbeat. Do not paste ping URLs or keys into reports.
- **D1 unavailable:** public status returns 503 rather than invented state. Restore
  dependable storage before diagnosing Beam output. A failed heartbeat is independent
  evidence; an incident cannot always persist during a database outage.

## Migration, rollback and retention

Versioned migration 0004 adds operational state without dropping core history.
Apply forward migrations before activating new code. Local SQL atomic rollback,
repeat initialization and workerd compatibility are tested; remote migration and
production restoration are **not**. Stop local servers before copying/restoring the
ignored `.wrangler/state` directory. Keep backups private. Never commit database dumps.

Before deployment preparation, design and exercise an owner-approved remote export,
restore and rollback against TEST, including configuration, overrides, observations,
leases and quota counters. Releasing older code must not reset counters or activate a
Cron accidentally. Prefer additive fixes; do not erase audit/history with destructive
down migrations. Retention currently deletes transient data only. Forecast D1 storage,
rows read/written and Worker limits with representative history before launch.

## Activation checklist — every external step still requires approval

1. Review Milestone 2 local commit and authorize its push separately.
2. Recheck current provider terms, free entitlements, actual billing-cycle boundaries,
   real Kings matching, category coverage and latency with a separately approved budget.
3. Confirm a free Cloudflare Access setup protects the configured admin host/path and
   all preview/default-host alternatives; verify real signed owner claims and CSRF.
   If mixed public/private routing cannot be secured, keep admin closed and review a
   separately protected admin Worker. Do not enable paid Access.
4. Confirm free Email Routing send_email availability with an existing suitable domain
   and verified recipient, or obtain approval for a different free delivery mechanism.
   Separate TEST and production bindings; no recipient or real sender is committed.
5. Approve actual TEST/production Workers and distinct D1 bindings, migrations, least
   privilege, secret installation, quota period/caps and initial history boundary.
6. Approve fresh Healthchecks URLs separately by environment. Exercise missing heartbeat,
   incident/recovery retries and a test email without exposing URLs.
7. Approve TEST deployment and verify actual host/authentication/storage isolation first.
   Cron, `OPERATIONS_ENABLED`, `ADMIN_ENABLED` and `NOTIFICATIONS_ENABLED` are separate
   activation gates. TEST `liveTest` must also be explicitly enabled.
8. Only after explicit production approval, activate production and validate public JSON,
   controls, no-Cron midnight expiry, monitoring and restoration/rollback. No deployment
   commands are supplied or executed as part of this milestone.

No planning-conversation PROJECT_HANDOFF.md is copied. The authoritative specification
still lists that filename; the owner's instruction to maintain continuity separately
continues to take precedence. README, changelog and these operational docs record progress.
