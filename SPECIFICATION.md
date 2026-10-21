# Sacramento Kings Beam Status Service
## Codex Implementation Specification — v2.1

**Status:** Consolidated owner-approved requirements; not authorization to deploy  
**Prepared:** October 21, 2026  
**Supersedes:** `kings_beam_codex_spec_v2.0.md` (which superseded v1.0)  
**Master planning conversation:** Kings Beam API — Master

> **Primary instruction to Codex:** Implement this specification in testable stages. Begin with a short feasibility/credential check and report blockers before building dependent features. Do not deploy publicly, buy services, change DNS, initiate paid trials, or modify accounts without explicit owner approval. Never expose or request API keys in chat or committed code.

## 1. Purpose and success definition

Create a small, independently hosted, free-tier-first public API that reports whether the Sacramento Kings' celebratory victory Beam **should be ON or OFF** according to **owner-configured game eligibility and final results**. It is a *calculated fan indicator*, not a sensor or proof that the physical beam is lit. Its output is public machine-readable JSON usable by websites, Apple Shortcuts, and similar clients. An optional simple landing page is in scope; an NBA scores site is not.

The service must work without Squarespace, a continuously running home computer, or routine manual involvement. Start at a free `workers.dev` URL; optional custom-domain mapping requires later owner approval. Public reads must not depend on an upstream API being reachable at that moment. Any uncertainty must be surfaced rather than presented as independently verified data.

**Noncommercial use is an explicit owner decision:** no subscriptions, advertising, sponsorships, donations, sale of API access, or sports-data redistribution. The public API remains free. Reassess licensing if this changes.

**Nonnegotiables:** correct Pacific time and midnight reset; eligible *final* victories only; provisional ON permitted from one valid provider under the conditions in §7; independent score comparison after Kings games when both providers cover the game; configurable eligibility and provider priorities; secure manual controls; incidents and email alerts; restart/recovery; isolated real-game and simulated testing; no secrets in public code; and a $0/month operating target subject to verified free-tier restrictions.

## 2. Changes from v2.0 — authoritative decision log

1. **Provider replacement:** Primary remains **BALLDONTLIE** (`balldontlie`); second source is **The Odds API** (`odds_api`). **API-Sports NBA is removed from this project entirely**: no adapter, key, config option, quota logic or live dependency. Do not use ESPN for automated access. No webhooks.
2. **Evidence obtained:** Owner/Codex tested BALLDONTLIE current-season scores, team identity and classification queries; The Odds API returned 46 NBA events (3 completed) at 2 credits. Three sampled final games matched BALLDONTLIE. This is a limited compatibility test, *not* proof of season-long coverage, live update latency, or perfect independence.
3. **Approved provisional ON:** A valid final eligible Kings victory from BALLDONTLIE can publish ON with `verified:false` while The Odds API catches up. An Odds API final can do so **only if the game's eligibility is already reliably known from persisted classification**. Both agreeing on a uniquely matched final result and winner/scores may upgrade to `verified:true` provided eligibility is established and data is current. Normal propagation delay is not a conflict.
4. **Late conflicting finals:** If ON is supported *only* by newly disputed evidence, withdraw that ON, mark unverified, preserve both observations/audit, and alert. Do not erase other uncontroversial same-day wins or override a current manual decision.
5. **Configurable game eligibility:** In the default policy **all seven named categories are enabled except Summer League**. This supersedes fixed restrictions in v2.0. The dashboard must allow changing categories without code edits; defaults and resets are specified in §5. Unrecognized classifications remain pending review, not automatically eligible.
6. **Classification roles:** BALLDONTLIE and independently validated reference mappings establish game type/eligibility. The Odds API currently supplies final scores/winners without reliable competition metadata. Its score agreement alone is not a game-type verification.
7. **Completion timing:** Neither sampled API has a reliable actual completion timestamp. Preserve last-nonfinal and first-observed-final instants. Do not silently infer an exact completion date from scheduled start or Odds API `commence_time`/`last_update`.
8. **Credit budgeting:** The Odds API free plan advertises 500 credits/month, with a completed-score query using `daysFrom` observed to cost 2 credits. Account credits, renewal, and terms must be checked before deployment. Production checks outrank optional alternate-team tests.
9. **Noncommercial:** Owner has confirmed no monetization of the public status service. Do not publish provider-derived scores, raw observations, schedules, or a general sports feed through the public endpoint.
10. **Infrastructure retained:** Cloudflare Workers + D1 + Cloudflare Access + Healthchecks.io with GitHub source control, isolated test Worker/database, five-minute Cron decision loop, configurable sources, manual mode, and delayed deployment approval.
11. **Configured services to date:** GitHub repo `WillowEng/kings-beam` exists; Cloudflare free Workers and separate D1 databases `kings-beam-prod`/`kings-beam-test` created; Healthchecks.io email test succeeded and exposed initial test check was deleted; Cloudflare Access activation is **deferred**. Both relevant keys have been added as Codex cloud **network secrets**, but **not yet** as Cloudflare Worker secrets. None of this implies that the application has been implemented or deployed.

## 3. Deliverables

- Deployable TypeScript Cloudflare Worker with public HTTP `fetch` handler and five-minute Cron `scheduled` handler, or separate secure admin Worker if required by verified hostname security.
- Versioned D1 schema/migrations for normalized games, provider observations, cached eligibility, settings, overrides, state, sync checkpoints, usage budgets, alerts/outbox, and audit history.
- Public stable **`GET /status.json`** JSON contract (§9); an optional simple original-design homepage.
- Private mobile-friendly administration dashboard: source management, eligibility switches and restore-defaults, modes, manual control, diagnostics, alerts, quotas, histories and a clearly separated TEST view.
- Provider adapters **only** for BALLDONTLIE and The Odds API in v2.1; strict parsing, canonical team/game matching, score comparison, source errors, and budget control.
- Kings-only production processing; isolated alternate-team live testing selectable by team; deterministic simulations and automated tests.
- Healthchecks.io heartbeat + email incident/recovery design, test-email routine, setup and safe operations instructions.
- GitHub-ready code with README, `.gitignore`, `.dev.vars.example`, change history, operations runbook, setup guide, deployment/rollback/backup steps and example API clients.
- Measured vs unverified assumptions clearly distinguished; owner permission gates before external changes and deployments. No real credentials in files or chat.

## 4. Hosting, service boundaries and cost

- **Cloudflare Workers + D1 free tier**, using Wrangler for TypeScript, migrations, development, and deployment. The public API reads D1 and applies time logic; it **never** fetches external scores on an incoming public request.
- Initial public address: an owner-approved `<worker>.<account>.workers.dev` URL, separate from Squarespace. Custom DNS/subdomain is optional later.
- One Cron Trigger scheduled every five minutes (`*/5 * * * *`, UTC) as a **decision loop**, not a requirement to query upstream every five minutes. Store next-due times per source and game.
- Separate production and test Workers, separately writable D1s (`kings-beam-prod`, `kings-beam-test`); test runtime cannot bind or write production state. Test cron is off until approved.
- All `/admin` and `/admin/*` routes and every admin mutation must be authenticated **server-side** through configured Cloudflare Access plus explicit owner identity checks. Ensure no `workers.dev`/preview/custom hostname bypass. If mixed public/private access cannot be secured comprehensively, use an independently secured admin Worker. **Access is not yet activated; do not deploy exposed admin routes.**
- Healthchecks.io independently detects missing Cron runs and emails the owner; per-incident deduplication and recovery logic live in the backend. Existing Healthchecks account/email delivery has been tested; new live checks/secret ping URLs are not yet configured.
- **$0/month goal:** no paid providers, billing features, credit-card trials, domain purchase, or automatic paid upgrades without permission. Alert and degrade safely when limits are reached. Reconfirm provider account entitlements and platform limits before launch.
- **Noncommercial operation** with free public access; do not output third-party proprietary content as a replacement data service.

## 5. Game eligibility, time, and Beam state

### 5.1 Default configurable eligibility

Production team is the **Sacramento Kings**. Team identity must be validated using canonical IDs/mappings, not display-name substring matching alone. Winning at home or away is equally eligible.

These are **owner-selected defaults for the calculated indicator**, not verified claims about exactly when the physical Kings Beam is lit:

| Game category | Default | Meaning |
|---|---|---|
| NBA Regular Season | **ON** | Includes games counting toward regular-season standings |
| NBA Playoffs | **ON** | Official postseason playoff games |
| NBA Play-In Tournament | **ON** | Treat separately from regular playoffs |
| NBA Cup (Regular Season) | **ON** | Cup group/knockout games officially counted as regular-season games |
| NBA Cup Championship | **ON** | Cup final even if not a regular-season game |
| NBA Preseason | **ON** | Official preseason games |
| NBA Summer League | **OFF** | Disabled unless the owner explicitly enables it |

- Expose seven individual ON/OFF controls and **Restore Defaults** in `/admin`; persist the settings in production D1 with settings version and audit entries. The isolated TEST environment has its own values and reset action. No code edit or redeployment required to change an existing category.
- The distinction between **NBA Cup regular-season games** and **NBA Cup championship** matters even though both start ON, because their settings can later diverge.
- **Owner-approved clarification — category precedence:** Each game belongs to one exclusive eligibility category. NBA Cup regular-season games are governed by `cup_regular`, independently of the general regular-season switch.
- Unknown, unsupported, exhibition/other, or ambiguous competition classifications **do not silently default to eligible**. Flag for review and alert when relevant; adding a new category requires deliberate mapping and owner choice. Do not equate `postseason:false` with regular-season eligibility.
- Obtain BALLDONTLIE classification from explicit season-type query provenance or vetted corroborating metadata/mappings. Sampled game responses may omit a `season_type` field. Save the query context that established each category. Sampled `season_type=playin` records had `postseason:false`; `season_type=ist` captured the NBA Cup championship whereas Cup group/semifinal games can appear in `regular` with `ist_stage`. Never treat all `ist` or all `postseason:false` results as one category. Match real fixtures before enabling broader competition coverage.
- If BALLDONTLIE does not expose a default-enabled category (for example some preseason/Cup or Summer League games), record **coverage unsupported/unverified** instead of pretending both sources monitor it. Never label a skipped game as a loss. The Odds API does not resolve classification by itself.
- A scheduled, live, postponed, delayed, suspended, canceled, or abandoned game is not a completed victory and must not turn ON.

### 5.2 Automatic Beam calculation

- `AUTO` is the normal mode. After a **valid final eligible Kings victory**, ON runs until the **next midnight in `America/Los_Angeles` following the game's actual Pacific completion calendar date**; otherwise OFF. A final loss never turns ON. One same-day loss does not erase another established eligible same-day victory.
- `verified:false` is allowed for a provisional ON when exactly one valid source establishes a final eligible victory, subject to §7. The app must not falsely describe one-source publication as independently verified.
- Apply Pacific midnight expiration **on every public read**, without waiting for a Cron invocation. UTC instants are stored ISO 8601. Convert with IANA `America/Los_Angeles`, including DST and games crossing midnight; do not use a fixed UTC offset.
- Prefer a trustworthy actual completion timestamp **if later made available and verified**. At present, neither provider's sampled scores payload has one: BALLDONTLIE `datetime` and Odds `commence_time` are starts, while Odds `last_update` is not a confirmed end. Store `last_observed_nonfinal_at`, `first_observed_final_at` and an interval/basis for end-date confidence. Do not backdate completion from tipoff or publication timestamps.
- When the possible end interval crosses Pacific midnight and no authoritative evidence determines the correct completion day, mark the date **uncertain**, do not activate a new ON on the basis of that ambiguous date, and alert/allow manual resolution. Do not publish an ungrounded `last_win` completion date.
- Down-time backfill cannot re-activate ON for a victory whose applicable Pacific day has already expired. Unresolved coverage gaps lower confidence; distinguish calculated OFF from confidently verified OFF.

### 5.3 Manual controls and manual-only mode

- Authenticated controls: `AUTO`, `FORCE_ON`, `FORCE_OFF`, plus independent `manual_only` toggle. Use POST, confirmation, author/UTC timestamp, optional reason and append-only audit.
- Manual force overrides take effect immediately and expire at **next Pacific midnight**, returning to AUTO unless manual-only mode is active. `AUTO` clears a force override immediately. Cron may still gather source observations while a force override is active.
- `manual_only` persistently prevents automated publication but may permit data collection for diagnostics. Expired manual ON in manual-only returns to safe OFF/uncertain until explicit owner action or switching back to AUTO. Manual controls remain authoritative even when sources disagree.
- Overrides and configuration are isolated between production/test; repeated actions or delayed scheduled jobs cannot resurrect an expired override.

## 6. Sports-provider integration and normalized observations

### 6.1 Primary: BALLDONTLIE (`balldontlie`)

- Base: `https://api.balldontlie.io/v1/games`, using `BALLDONTLIE_API_KEY` in the server-side `Authorization` header; `/v1/teams` supplies team identity.
- Verified in Stage A using an owner-provided key: authenticated Teams/Games requests returned HTTP 200; current-season games, final states/scores, explicit regular/playoffs/preseason/play-in queries, Cup observations, and five-requests/minute headers were observed.
- **Verified BALLDONTLIE team IDs:** Sacramento Kings `26`; Oklahoma City Thunder `21`. These are **provider-specific**, not canonical global IDs.
- Validate `status_state` final lifecycle, final scores, team IDs, scheduling and query provenance; pagination/date boundaries; tolerate additional response fields not present in a partial OpenAPI schema. Never assume `postseason:false` establishes regular season, or that provider `datetime` is a final timestamp.
- Respect 5 requests/minute **across test, production and manual diagnostics** with conservative spacing and quota coordination; never publish its raw payload to the public endpoint.

### 6.2 Secondary: The Odds API (`odds_api`)

- Endpoint: `https://api.the-odds-api.com/v4/sports/basketball_nba/scores/` using secret `ODDS_API_KEY` as `apiKey` **server-side query parameter**. Do not log request URLs, query strings, response headers containing credentials or secret substitutions.
- **Observed in Stage A:** one request with `daysFrom=3` returned HTTP 200 with 46 events, three completed games, and an `x-requests-last` cost of **2 credits**; `x-requests-used: 2`, `x-requests-remaining: 498`. Current-season games and upcoming Kings games were present. This does **not** prove every competition type is included.
- Use `completed:true`, strictly validated nonnegative integer scores parsed from numeric **strings**, actual home/away team names, and a unique matched game. Avoid index-based score association. The API may not expose provider team IDs or category. `commence_time` is not the actual game end. `last_update` is not a reliable game-end timestamp.
- Odds API score history only extends over a **limited recent window** (advertised up to three days); do not depend on it for historical backfill. Persist confirmations promptly; after window expiry historical evidence may remain single-source.
- **Free tier:** published 500 monthly credits with actual renewal and available credits to be verified from account/dashboard; completed-score requests with `daysFrom` observed at 2 credits. Use credit budgets shared across environments, honor provider headers, and stop optional tests first when credits run low. Do not request bookmaker odds or betting features.

### 6.3 Removed data sources

- **Do not implement or use API-Sports NBA** in v2.1; its free account rejected 2026-season queries and the owner removed it. Its former `API_SPORTS_KEY` must not be read, documented as required, or copied to Cloudflare. Do not implement an unused adapter.
- **Do not poll ESPN**; previous terms/licensing concerns. There are **no webhook requirements**.
- Later additions/replacements require a tested adapter, licensing review, explicitly authorized credentials and owner approval. Config switches apply without code edits only for already implemented adapters.

### 6.4 Provider-neutral observation and game matching

Each provider adapter should produce a typed validated normalized observation, with unsupported fields explicitly null/unknown; suggested model:

```ts
type GameObservation = {
  provider: 'balldontlie' | 'odds_api';
  providerGameId: string;
  canonicalHomeTeamId: string;
  canonicalAwayTeamId: string;
  canonicalGameId: string | null;
  competitionType: 'regular' | 'playoffs' | 'playin' |
    'cup_regular' | 'cup_championship' | 'preseason' |
    'summer_league' | 'other' | 'unknown';
  classificationProvenance: string | null;
  lifecycle: 'scheduled' | 'in_progress' | 'final' |
    'postponed' | 'canceled' | 'other' | 'unknown';
  homeScore: number | null;
  awayScore: number | null;
  scheduledStartAt: string | null;  // UTC, NOT actual end
  actualCompletedAt: string | null; // authoritative only
  observedAt: string;              // UTC: request observation
  eligibilityConfidence: 'confirmed' | 'uncertain';
};
```

- BALLDONTLIE names/numeric IDs differ from Odds API names/opaque IDs. Maintain vetted team aliases (e.g., `LA Clippers` / `Los Angeles Clippers`), canonical IDs and separate provider IDs. Codex verified that even scheduled starts can differ by 10–22 minutes. **Do not** require exact timestamp equality or match only by date/name. Match validated home/away teams, proximity within defensible windows, season context, schedule changes and a unique candidate; ambiguous pairs remain unmatched and alerted. Persist mappings after deterministic match.
- Treat unknown game type from Odds as **unclassified**, not an error in score parsing. Eligibility is a separate persisted property established through BALLDONTLIE query provenance or separately vetted mapping; never upgrade eligibility merely due to Odds score agreement.
- Validate final lifecycle and score pair. Completed NBA scores cannot be tied; reject malformed, missing, negative, fractional or inconsistent scores. An HTTP 200 with provider error content is not automatically a valid result.
- Run-time validation must tolerate unrelated additional properties but reject missing essentials. Set fetch timeouts, bounded retries/backoff, clean error categories and idempotent persistence. A public client must never cause an upstream call.

## 7. Publication, verification, conflict and fallback policy

The **owner approved Option A**: publish a provisional ON on a single valid, **eligible final Kings victory**, then upgrade when two providers agree. This policy is binding and supersedes suggestions to require two-provider agreement before any ON. Expose a `require_dual_agreement_for_on` setting if desired, but default it **OFF**.

**Always attempt both enabled sources after each Kings game that the system can identify and that is within each provider's coverage/credit window.** BALLDONTLIE supplies event discovery/type classification; Odds supplies independent final-score corroboration (not independent eligibility classification). Provider priority determines preferred first lookup/decision when applicable but never removes the independent verification objective.

| Observed situation | Required behavior |
|---|---|
| BALLDONTLIE establishes eligible final Kings win; Odds pending, delayed, inaccessible or not yet covering game | Publish **ON, `verified:false`** provisionally; retry when budget permits. |
| Odds reports final Kings win first; trustworthy classification for **same canonical game** was previously stored as enabled | Publish **ON, `verified:false`** provisionally, then seek BALLDONTLIE final. |
| Odds says Kings win but no reliable prior game eligibility is known | **Do not automatically turn ON**; mark pending classification, notify owner if time-sensitive. |
| Both match same uniquely identified game, final score, winner; eligibility already confirmed enabled; coverage current | Publish/retain calculated state, **`verified:true`**, `source:'dual'`. |
| One provider is delayed/in-progress and the other final | No conflict merely for lag. Use eligible valid provisional result, retry without spamming. |
| Both claim final for same game but scores or winner conflict | Mark disputed and `verified:false`; withdraw an ON supported solely by the disputed event, preserve any **other** uncontested same-day win and active manual override; alert and reconcile. |
| One provider does not cover a known game category | Treat as coverage gap (not provider outage or fake disagreement); eligible BALLDONTLIE victory may remain **single-source provisional**, not verified. |
| Both required sources fail/credit budget exhausted | Preserve best sound time-derived state and manual mode, never fabricate a win/loss; mark unverified and alert when action is blocked. |
| Confirmed eligible final loss or no qualifying final victory by current day | OFF, with `verified` dependent on actual schedule/result coverage; never interpret absence of data as loss. |

- If a provisional win is contradicted later, **withdraw only the disputed support for ON**, mark state uncertain/unverified and retain both raw normalized observations and audit history. Never erase another supported eligible victory or override a manual action. Automated destructive rollback of historical records is prohibited.
- Eligibility setting changes apply prospectively immediately to the *calculated state* on the next request, with audit. Reevaluate cached same-day results against new settings without inventing additional observations. Changing eligibility does not retroactively re-light the Beam after a prior midnight.
- An enabled Odds API may be unable to confirm preseason/Cup/play-in games. Never label `verified:true` solely from BALLDONTLIE even if a certain category is unavailable from Odds. Separate `source_health`, `coverage`, `score_agreement`, `classification_confidence` and `timing_confidence` in private diagnostics.
- Record timestamps of checks, first final observation, upstream response time, matching/conflicts and retry history. Agreement does not prove independent upstream provenance or guaranteed real-world accuracy. Do not call normal final propagation delay an outage.
- Make repeated polling, retries and concurrent admin operations idempotent with unique game/provider keys, guarded state changes, and durable incident deduplication.

## 8. Scheduled polling, quotas and recovery

- Run Cron `*/5 * * * *` UTC as a decision loop, **not** an upstream request every five minutes. Use stored games, next due checks, current pending outcomes, source coverage and budget to decide which calls are needed.
- BALLDONTLIE discovers upcoming games and checks near their anticipated end, using low frequency from about 90 minutes after tipoff then 5–10-minute checks when appropriate. Continue for overtime, postponements and delayed starts; end active checks after verified result or known coverage limitation. Refresh schedule at least daily during active season, scanning Pacific/UTC adjacent dates where needed. Do not poll irrelevant days repeatedly.
- After an eligible final is first detected, **batch** a single NBA scores check through Odds API (potentially covering Kings and test-team games). If unresolved, suggested credit-conscious retries approximately **15, 45 and 120 minutes** later, as long as the result remains within history and budget. If BALLDONTLIE is temporarily down, the *persisted* schedule must still initiate appropriately timed, bounded Odds checks; do not wait indefinitely for BALLDONTLIE to call first.
- Odds API `daysFrom` finished-game request observed **2 credits**. **Default cap: at most 450 of advertised 500 credits per billing month** across combined production/testing/manual/recovery operations, leaving 50 credits of safety margin. Suggested allocations within the 450: production 260; optional live test 80; recovery 75; diagnostics 20; emergency 15. Codex may tune allocations with owner approval after observing actual games. Count credits, **not just requests**. Derive reset cycle from actual account evidence, not a hard-coded calendar assumption.
- BALLDONTLIE cap: five requests/minute account-wide across Workers and manual diagnostics. For Odds API, production/test accounts share credit allowance even if their D1s are isolated. Implement safe coordination/partition: never let test use production reserve. If independent env DBs cannot coordinate shared quotas securely, conservative disjoint allocations and provider-header reconciliation are required; document possible calls from outside Workers (e.g., Codex diagnostics) that cannot be centrally counted.
- On approaching hard caps, reduce optional test polling first; preserve emergency production checks. On exhaustion, log the gap, mark uncertain, alert where relevant, and stop rather than trigger paid usage. Respect HTTP 429, `Retry-After`, backoff/jitter and provider limits.
- Admin **Run Now** and **Test Connection** actions must consume budgets, return actual check/skip/error outcomes, and cannot evade account limits. Limit repeated clicking and reject stale/overlapping runs.
- **Recovery:** maintain schedule scan completeness, per-game final-confirmation state and separate primary/secondary last-good observations. Backfill all missed games via BALLDONTLIE as far as practical; attempt Odds reconciliation **before its recent-history window expires**. After an interruption older than the Odds history, keep older results single-source/unverified if secondary evidence wasn't saved; don't claim historical dual verification. Record gaps explicitly and alert; no retroactive expired-day ON.
- On initial setup, retrieve enough trustworthy history to establish latest relevant eligible win; if unprovable, emit `last_win:null`, `verified:false`. Rechecking first hours/day after installation must not silently fabricate a verified history.
- Avoid writing D1 rows when durable state is unchanged beyond minimal heartbeat/diagnostics with retention. Public reads must not call providers or write D1.

## 9. Public API contract and timing behavior

### 9.1 `GET /status.json`

Expose a stable public JSON response: HTTP 200 for normal healthy/degraded conditions, `Content-Type: application/json; charset=utf-8`, `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`. Do not allow browser or CDN cache to hold ON past midnight. The v1-shape sample below is **illustrative, not a real NBA result**:

```json
{
  "beam_on": false,
  "verified": true,
  "last_win": "2026-10-18",
  "mode": "auto",
  "source": "dual",
  "checked_at": "2026-10-20T12:00:00Z"
}
```

- `beam_on`: Boolean, derived on request from reliable accepted game/override history, current eligibility configuration and Pacific midnight boundary. An upstream error is never a Kings loss.
- `verified`: `true` only if outcome evidence from **both sources** agrees on a uniquely matched final game *and* eligibility is established and relevant coverage/freshness remains current, or if verified schedule coverage establishes no unresolved game affecting today's OFF state. `false` for single-source/provisional, category missing, conflict, ambiguous midnight completion, relevant outage/gap, stale data, and manual modes. A future single-source-only special case must not silently become verified.
- **Owner-approved clarification — verification scope:** Historical single-source or unverified games must not permanently prevent future statuses from becoming verified. However, unresolved games that could affect the current Pacific day's Beam state must reduce current verification confidence.
- `last_win`: latest relevant eligible victory's **certain Pacific completion date**, or `null` if unknown/unprovable; provider game dates and scheduled start dates are not substitutes for an authoritative completion date.
- `mode`: `auto`, `manual_on`, `manual_off`, `manual_only` (document effective selection consistently).
- `source`: `balldontlie`, `odds_api`, `dual`, `manual`, `none`. `dual` means two agreeing final score observations for the same eligible game, never just two configured providers.
- `checked_at`: latest successful **relevant** source validation in UTC ISO 8601, or `null` until established. Failed requests do not advance this timestamp.
- Any `verified:false` status must remain meaningful rather than implying fresh certainty. No raw provider scores, complete sports fixtures, private diagnostics, authenticated URLs, email, tokens or secrets are publicly exposed.

New optional fields may be added compatibly with clear documentation; breaking changes require a new versioned endpoint. Provide examples for an uninitialized state, provisional ON, disagreement-withdrawal, outage, and manual override. Source provenance and detailed verification belong in authenticated admin diagnostics.

### 9.2 Serving and failure behavior

- Every request calculates effective Pacific midnight expiration and override expiry directly from persisted data; no Cron dependency. Stale stored scheduler health or unresolved current game prevents an indefinite `verified:true` even if Cron stops.
- On D1 unavailability without dependable saved state, return HTTP `503` with JSON service-unavailable content, not invented `verified:true`.
- Public `GET /status.json` is open; all `/admin*` requests are explicitly secured. Unknown paths return 404 without stack traces.
- Optional `GET /` may use an original Beam-style status indicator and independent-fan disclaimer. Do not use official logos/graphics or present a calculated indicator as physical sensor readings.

## 10. Administration, eligibility controls and diagnostics

Provide a phone-friendly private owner dashboard on `/admin`, securing all `/admin/*` APIs and any alternate hostnames with Cloudflare Access plus server-side verified JWT/owner authorization, origin and CSRF protections. POST only for mutations; transactional settings revision checks and idempotency guards prevent accidental repeat changes. If Access cannot protect mixed public/private routing on every hostname, split admin into a separately protected Worker.

1. **Overview:** current calculated state and confidence, next Pacific midnight, recent game and win, upcoming games, provider checks and coverage, last cron, incidents, credits and free-tier usage.
2. **Beam control:** big confirmed AUTO / ON / OFF actions; separate manual-only toggle; override expiration in Pacific local time; authorized actor, optional reason, audit.
3. **Game Eligibility (required):** seven independent switches exactly matching §5 defaults, persisted and auditable in production D1, with **Restore Defaults**, change confirmation, and clear warning if a category lacks provider coverage. The isolated TEST environment has separate eligibility switches and defaults. Unknown categories shown as pending review, not silently enabled.
4. **Providers:** enable/disable BALLDONTLIE and Odds independently; reorder priority; configure default provisional/strict-two-source ON policy (default provisional), run single-provider test, inspect quotas and last responses/coverage. Reject disabling all automation without explicit confirmed manual-only mode. Secrets are neither shown nor editable in HTML.
5. **Diagnostics:** Run Now; compare matched games and provider identifiers; show outcome, source timestamps, classification provenance, last-nonfinal/first-final interval and timing confidence; Test Alert Email; view skipped due to quota or unsupported coverage separately from failures.
6. **History and monitoring:** read-only game/override/configuration/audit/incident logs, filtered by environment, with alert acknowledgement and recovery status.
7. **Testing:** clearly marked **TEST — DOES NOT AFFECT KINGS**, configurable alternate team, live-test on/off and simulated scenarios. Never permit a test team to be set through production write paths.

Source priority and eligibility settings must take effect without code edits by the next scheduled check and, where safe, immediately in derived public state. A new, previously unknown provider still requires implemented/tested code and an explicit credential/licensing approval. No API key or full Odds API authenticated URL may appear in HTML, logs, error messages, or public assets.

## 11. Real alternate-team testing, simulations, and isolation

### 11.1 Strict separation

- `kings-beam-prod` and `kings-beam-test` are **different D1 databases**, bound to different Cloudflare Workers/deployments. The test runtime must have no writable binding, service token, or administrative action that can update production state or email incidents.
- Share business logic and adapters in source; isolate team selection, eligibility config, state/override tables, schedules, alerts, quota allocation, and auth by runtime config. Both may use the same provider *accounts*, hence global rate/credit accounting remains a deliberate exception to data isolation.
- Test status must be private/authenticated by default, not confused with public Kings `/status.json`. Test URLs and UI always state **TEST — DOES NOT AFFECT KINGS**. Disable test Cron until specifically authorized.

### 11.2 Live alternate team

- Select any reliably mapped NBA team, starting with **Oklahoma City Thunder**. BALLDONTLIE ID observed `21`; Odds API identifies by name/aliases and must use canonical matchup matching rather than an invented numeric Odds ID.
- Track real final results, eligibility, provisional/verified statuses, provider coverage and lag with the **same rules as production**, but independent storage/settings/manual controls. Prefer reusing a single Odds NBA response to check Kings and Thunder when both games are in the recent-history window.
- Test budgets are lower-priority than production; pause automatically when credits are needed for the Kings. Test email/monitoring is separate from production incidents.

### 11.3 Deterministic tests

Use fixtures (no API credits) for eligible victories and losses in **all seven categories**; Summer League excluded by default then enabled; restore defaults; unknown category; category changes during same Pacific day; class-provenance missing; provider mismatch or missing team ID; Cup championship distinct from Cup regular; play-in false `postseason` values; preseason coverage gaps; Odds-only final with known vs unknown eligibility; late contradiction withdrawing provisional ON; independently supported same-day win retained; and manually forced ON taking precedence.

Also test scheduled/in-progress/canceled/postponed games; API failures and schema changes; invalid score string, absence of scores, 429 and credit depletion; start-time differences and aliases; duplicate or reordered observations; overlapping cron/manual checks; D1 write failure; no-Cron midnight expiration; 11:59 p.m./12:01 a.m. Pacific and DST boundaries; missed days and Odds history expiry; initial uninitialized history; manual-only expiration; admin JWT/CSRF/preview-bypass; and absolutely no test writing production D1.

Every simulated scenario displays actual PASS/FAIL and inputs. Genuine provider checks must be labeled live only when a request succeeded; fixtures are not proof of access.

## 12. Monitoring, incidents, and email

- External **Healthchecks.io** heartbeat monitors Cron liveness even when the Worker never runs. The owner's email notification integration has been manually verified in setup; no active service check is configured yet. Fresh check URLs must be generated and stored as **secrets**, never committed or shown in screenshots/chats.
- Heartbeat should only count as successful after required durable bookkeeping; missing heartbeat triggers external notification. Keep intentional off-season/no-game ticks alive without falsely reporting upstream failure.
- Track separate incidents for source failures (only after actual attempted checks), prolonged missing/unverified final, provider final-score disagreement, unknown/unsupported category blocking a potential win, missing Cron, quota blockage, failed D1 writes, recovery gaps and public-serving failure where detectable.
- Deduplicate per incident: one opening alert and one recovery alert; escalate only for genuinely worse impact. Log initial and last observation, status, acknowledgement, issue category and environment. Scheduled vs final lag or a known secondary coverage gap is not automatically a source failure.
- Use an outbox with idempotency/retries or an equivalent durable design for notification requests so database changes and external pings don't create uncontrolled duplicate emails. Do not promise exactly-once delivery.
- Use a separate safe **Test Alert Email** check that does not corrupt real incident/heartbeat state. Preserve privacy; raw healthcheck ping URL is a credential.
- Monitor stored freshness deadlines so Cron failures cannot leave public `verified:true` indefinitely. Consider free external status HTTP monitoring only if available and owner-approved; never require a paid service.

## 13. Database, security, noncommercial licensing and operations

### Minimum D1 data model

- `teams` / `provider_team_ids` / `team_aliases`: stable canonical identity and verified mappings, including Odds names and alternative names.
- `games`: canonical game ID, teams, season, schedule and completion confidence, classification, provenance and current final/reconciliation state.
- `provider_observations`: per-source game ID, lifecycle, final scores, observed/last-nonfinal/first-final times, parsing outcome, matched canonical game, safe audit metadata.
- `eligibility_settings`: seven owner toggles plus defaults/version/actor/time; separate values per environment.
- `settings` / `overrides`: provider enable/order, `require_dual_agreement_for_on` default false, `manual_only`, force override, expiration, revision.
- `beam_state`: last accepted win and derived response checkpoints, avoiding stale yes/no as authoritative across midnight.
- `schedule_sync` / `recovery_checkpoints`: fetched intervals, known games and explicit gaps; primary vs secondary completeness.
- `provider_health` / `quota_counters`: API errors, credits consumed/remaining, period, reservations, last check and latency; track global-account risk across separate Workers.
- `incidents` / `notification_outbox` / `audit_log`: deduplicated failures, recoveries, config and manual activity, protected identity and delivery state.

Use versioned D1 migrations, validated unique/foreign-key constraints, conditional updates/atomic batches and expiring job leases to prevent double-processing. Do not assume unlimited long transactions or atomic D1-to-third-party email delivery. Backups, retention, scrubbed logging, restoration and migration rollback must preserve records/owner overrides rather than silently erasing history.

### Security

- GitHub repo is **public**; `.gitignore` must exclude `.dev.vars`, `.env`, secret dumps, unredacted API URLs, credentials and any private admin artifacts. Cloudflare secrets `BALLDONTLIE_API_KEY` and `ODDS_API_KEY` must be separately configured **only after owner authorization**. Codex environment network secrets already exist but are not Cloudflare Worker secrets and must not be presumed available at runtime.
- Server-side HTTPS calls, timeouts, input/schema validation, prepared queries, output escaping, authentication and owner allowlist, signed Access token validation, CSRF/origin defenses, least privilege, protection from client-triggered quota spending, and no secret-bearing responses/logs.
- No preview or custom hostname may bypass private auth. **Cloudflare Zero Trust/Access remains deferred** during initial setup; protected admin deployment is gated on solving this without unapproved paid activation.
- Public CORS `*` only for `/status.json`, not admin actions. Public API must not expose scores, schedules or detailed observations; only small derived Beam metadata.

### Licensing and project identity

- Independent **noncommercial fan utility**; no monetization, donations, advertisements, sponsorship, subscriptions or resale; no suggestion of official affiliation with Sacramento Kings/NBA; no official logos or derivative official art unless licensed.
- BALLDONTLIE terms reviewed in Stage A allowed derived applications subject to no substitute sports-data API; Odds API terms were subsequently reviewed as favorable for derived values, with restrictions on competing feed redistribution. These are working assessments, **not legal clearance**. Codex must re-check current versions before deployment and flag changes/ambiguity. Do not expose raw scores or game-history API for public redistribution.
- No automated ESPN. No API-Sports NBA. No gambling endpoints. No webhooks. Free-tier limits are operational limits, not a permanent fee guarantee.

## 14. Suggested GitHub repository structure

Existing repository: `https://github.com/WillowEng/kings-beam` (public; initial README may exist). Codex should merge thoughtfully with existing files and not overwrite unrelated work.

```text
kings-beam/
  README.md
  CHANGELOG.md
  SPECIFICATION.md             # authoritative spec copied from this v2.1 file
  PROJECT_HANDOFF.md           # current progress, decisions and next steps
  wrangler.toml                # Worker config and bindings; no secret values
  package.json
  tsconfig.json
  .gitignore
  .dev.vars.example
  migrations/
    0001_initial.sql
    ...
  src/
    index.ts
    scheduled.ts
    config.ts
    core/
      models.ts
      beam.ts
      time.ts
      eligibility.ts
      reconcile.ts
    providers/
      adapter.ts
      balldontlie.ts
      oddsApi.ts
    data/
      db.ts
    admin/
      auth.ts
      routes.ts
      ui.ts
    monitoring/
      health.ts
      alerts.ts
  test/
    fixtures/
    unit/
    integration/
    isolation/
  docs/
    setup.md
    public-api.md
    runbook.md
    monitoring.md
    security-and-licensing.md
```

File names/layout may change for sound reasons but preserve logical separation, versioned migrations, tests, documentation and a working handoff. Do not add an API-Sports adapter.

## 15. Implementation plan and owner approval gates

**Stage A — Close validation and align specification (no deployment)**
1. Treat prior Codex real API tests as evidence: BALLDONTLIE current-season access, classification-query provenance and 5/minute; Odds API 46 events/3 matching finals/2 credits. Acknowledge limits: no completed Kings game cross-check yet, no real latency measured, no authoritative game-end timestamp, incomplete non-regular competition coverage.
2. Review this v2.1 spec and produce a concise list of *genuine* blockers, not previously disproved API-Sports assumptions. Verify Odds free plan cycle and both terms at build/launch time. Do not consume more test credits without budgeting/owner approval.
3. With owner approval, add v2.1 spec to repo as `SPECIFICATION.md`, maintain `PROJECT_HANDOFF.md`, and scaffold minimal code/test harness/D1 migrations. **Do not deploy**.

**Stage B — Backend and data integrity**
4. Implement adapters for **BALLDONTLIE and Odds API only**, canonical team alias/id mapping, competition provenance/cache, validated score parsers, real final ingestion and D1 writes.
5. Implement approved provisional policy, independent secondary verification, delayed/reporting-gap handling, contradiction withdrawal, source settings, eligibility toggles, quotas and bounded recovery.
6. Implement Pacific clock calculation, midnight/DST logic, public JSON v1 compatibility and deterministic tests.

**Stage C — Monitoring and secure admin**
7. Implement authentication/owner validation, safe admin route design or dedicated admin Worker, CSRF, audit and mobile-friendly controls. Keep admin disabled/unreachable until Access is actually configured and tested.
8. Add source priority toggles, game eligibility and Restore Defaults, Run Now/Connection Test, manual overrides/manual-only, histories and diagnostic interfaces.
9. Implement external heartbeat and outbox-driven incident/recovery/test-email behavior, mocked until real monitoring activation is approved.

**Stage D — Isolated testing and evidence**
10. Create separate TEST Worker/D1 bindings, alternate-team selection and live pipeline with identical core logic, independent eligibility/settings and alert scope. Demonstrate no write path to production.
11. Execute full unit/integration/security suite, including observed field samples, errors, quota budgeting, game categories, source mismatches, midnight and DST. Conduct opt-in real-game observation to quantify provider lag and scoring agreement.
12. Confirm every admin hostname/protected route is secure; perform licensing, privacy and free-tier audits.

**Stage E — Explicit owner-approved launch**
13. Walk owner through secrets, Cloudflare Access activation, D1 migrations, Healthchecks check URLs, test deployment, Cron, public endpoint and any optional domain. Do **not** modify external accounts or deploy without approval for the specific step.
14. Deploy TEST with owner authorization, then production after smoke tests and access validation. Prove the real public JSON, independent verification where covered, Pacific midnight expiry, alerts, live manual overrides and source-management actions.
15. Deliver operational runbook, backup/restore and rollback commands, known limitations, version log and updated `PROJECT_HANDOFF.md`.

## 16. Acceptance checklist

Production is ready only after these are demonstrated or marked explicitly as owner-approved exceptions:

- [ ] A real current-season Kings game is parsed correctly by BALLDONTLIE, including explicit competition provenance. Odds has authenticated successfully; matching a real Kings game against Odds is tested when available.
- [ ] The Odds API is checked after applicable Kings games within credit/history limits. Three previously sampled other-team finals matched across providers; ongoing latency, coverage and reconciliation remain to validate.
- [ ] BALLDONTLIE win => provisional ON; Odds-first win => provisional ON **only with known eligible category**; two agreeing matched finals => `verified:true` when coverage/time confidence permits.
- [ ] Conflicting finals withdraw only disputed ON, preserve uncontroversial same-day win/manual override, audit and email; normal final-publishing lag does not trigger false conflict.
- [ ] Seven Game Eligibility defaults match §5 (all ON except Summer League); toggling, restoring defaults, D1 persistence and TEST isolation work without redeployment.
- [ ] Preseason, play-in, Cup groups and final, playoffs, Summer League and unknown classifications are tested with valid query provenance; missing category coverage is reported honestly.
- [ ] `beam_on`, `verified`, `last_win`, `mode`, `source`, `checked_at` follow public JSON contract, including DST, ambiguous midnight endings, and midnight expiry without Cron.
- [ ] Missing data/provider outages never become fabricated losses, verified confidence or invented completion timestamps; recovery windows and last-win history are tracked accurately.
- [ ] Secure AUTO/ON/OFF/manual-only and alert incident/recovery features operate; override expires at next Pacific midnight.
- [ ] API sources can be switched off/on and reprioritized without code editing; adding a third new provider still requires a new reviewed adapter.
- [ ] Public API is reachable without login; private admin paths are protected from all hostnames and previews, with owner auth/CSRF protections and no Access payment configured without consent.
- [ ] Live alternate-team TEST has independent Worker, D1, eligibility/config and incidents, with **no path** to modify production status.
- [ ] Fixture/unit/integration/security tests all pass and show exact evidence, including malformed scores, collisions and quota exhaustion.
- [ ] Shared BDL per-minute and Odds per-month credits are budgeted across environments; monthly credit and renewal entitlements are verified; no paid plan is required/enabled.
- [ ] Missing Cron produces independently originated email; repeated incidents are deduped and recovery is communicated; no secret monitoring URLs leak.
- [ ] Public response exposes only derived indicator metadata, not feed-grade raw scores/schedules or third-party art; noncommercial status and terms review documented.
- [ ] All documentation, startup, rollback, backup and restore procedures have been exercised or explicitly noted as unverified.
- [ ] No real deployment, external-account change or paid feature occurred without explicit owner permission.

## 17. Instructions to Codex

- **This v2.1 is the authoritative replacement for v2.0.** It preserves the underlying architecture/security/recovery requirements unless explicitly superseded here. The approved provisional ON behavior and seven eligibility defaults override conflicting prior text.
- Start by acknowledging what previous Stage A tests **actually established**, and what remains untested. Do not repeat the disproved assumption that API-Sports NBA is a usable free current-season source; it has been removed.
- Work in bounded stages with tests alongside implementation. After each stage, report files changed, exact commands/tests performed, results and blockers. Do not invent success or imply an API is live before deployed testing.
- No new purchases, trial activations, deployment, DNS changes, Cloudflare Access/payment enrollment, active Cron/monitoring setup or account edits without explicit permission.
- Before any network tests, enforce quota/privacy budgets and no credential logging (especially `apiKey` URLs). Never ask for raw keys in chat.
- If an assumption fails, propose the smallest safe change and wait for owner approval instead of silently reducing security, correctness, isolation or no-fee requirements.
- Do not add odds/betting functions, an NBA scores feed, logos, unsolicited analytics, automated ESPN polling, API-Sports NBA code or webhooks.
- Keep spec version, changelog and handoff files current after authorized repository changes. Show repository tree, setup steps, configuration/secrets inventory, demo public JSON and a deployment pause checklist.

## 18. Reference documents and observed validation evidence

### Provider documentation
- BALLDONTLIE NBA documentation: https://docs.balldontlie.io/
- BALLDONTLIE OpenAPI: https://www.balldontlie.io/openapi/nba.yml
- BALLDONTLIE terms: https://www.balldontlie.io/terms.html
- The Odds API scores guide: https://the-odds-api.com/liveapi/guides/v4/#get-scores
- The Odds API terms: https://the-odds-api.com/terms-and-conditions.html
- The Odds API plans: https://the-odds-api.com/

### Infrastructure documentation
- Cloudflare Cron: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare Access and Workers: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Cloudflare Access app paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Healthchecks pricing: https://healthchecks.io/pricing/
- Healthchecks failure signals: https://healthchecks.io/docs/signaling_failures/

### Stage A evidence supplied by the owner/Codex
- BALLDONTLIE authenticated Teams/Games; team IDs Kings `26`, Thunder `21`; current/previous seasons; classification-query responses; scores and finals; observed per-minute response quota.
- Odds API authenticated `basketball_nba/scores`, one `daysFrom=3` request: 46 events, 3 completed, 2 credits used, 498 remaining. Three completed October 20, 2026 games agreed in scores/winners with BALLDONTLIE; an upcoming Kings game was present. These samples are **not** proof of ongoing timely coverage.
- Odds provider IDs are opaque, team aliases differ, start times may differ 10–22 minutes. Both providers lacked a verified actual game-completion timestamp in their sampled responses.
- API-Sports NBA account (former candidate) blocked access to `season=2026` on free plan, and has been removed. Its earlier browser dashboard returned selected data but did not establish programmatic current-season entitlement.
- Terms analyses previously favored minimal derived noncommercial indicator, but must be rechecked for current versions before launch; no blanket license to re-publish a basketball data feed.

### Current setup state (not deployment evidence)
- GitHub public repository: https://github.com/WillowEng/kings-beam ; README initialized. Codex environment selected `kings-beam`.
- Cloudflare Workers free account exists; D1 `kings-beam-prod` and `kings-beam-test` created, schemas/migrations **not** installed by this spec.
- Healthchecks.io email test received; original unused check with visible ping URL deleted. Fresh check URLs must be generated for running service.
- Cloudflare Zero Trust/Access left unconfigured because account setup required billing details; still a **hard security gate** before exposing admin functions.
- In Codex **cloud environment**: `BALLDONTLIE_API_KEY`, `ODDS_API_KEY` available as network secrets. No Cloudflare runtime keys installed or Worker deployment verified.

---

**End of specification v2.1.** This file defines the requested implementation and documents earlier partial API tests. It does **not** authorize deployment or claim that Cloudflare Workers, access protection, email monitoring, or the public API are running.
