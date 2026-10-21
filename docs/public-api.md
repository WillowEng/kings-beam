# Public JSON contract (v1)

`GET /status.json` is public on the production-shaped Worker only. TEST and all
admin paths remain inaccessible (404) pending authenticated interfaces.

Normal healthy/degraded responses are HTTP 200 with these six fields:

| Field | Meaning |
| --- | --- |
| `beam_on` | Boolean, calculated at read time from eligible undisputed victories and effective manual controls. |
| `verified` | Both enabled sources agree on relevant finals, eligibility and completion day are known, schedule coverage is complete/current, and no relevant gap/failure remains. Verified schedule coverage can also establish no-game OFF. |
| `last_win` | Latest accepted eligible victory's certain Pacific completion date (`YYYY-MM-DD`), or `null`. Not a scheduled-start date. |
| `mode` | `auto`, `manual_on`, `manual_off`, or `manual_only`. Persistent manual-only takes precedence in this label even while a force override is active. |
| `source` | `balldontlie`, `odds_api`, `dual`, `manual`, or `none`. `dual` describes actual matching stored finals, not two configured providers. |
| `checked_at` | Most recent successful relevant evidence/complete-coverage observation in UTC, or `null`. Failures and manual actions do not advance it. |

Headers: `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
and `Access-Control-Allow-Origin: *`. CORS is not granted on private/unknown routes.
The endpoint never calls a provider, initializes storage or writes to D1.

## Illustrative responses (synthetic, not actual game evidence)

Uninitialized history, after local schema/identity initialization:

```json
{"beam_on":false,"verified":false,"last_win":null,"mode":"auto","source":"none","checked_at":null}
```

Provisional eligible victory:

```json
{"beam_on":true,"verified":false,"last_win":"2026-10-21","mode":"auto","source":"balldontlie","checked_at":"2026-10-22T05:00:00.000Z"}
```

Two agreeing finals, with established eligibility, timing and current coverage:

```json
{"beam_on":true,"verified":true,"last_win":"2026-10-21","mode":"auto","source":"dual","checked_at":"2026-10-22T05:00:00.000Z"}
```

Disagreement withdraws the sole disputed victory; observations remain private:

```json
{"beam_on":false,"verified":false,"last_win":null,"mode":"auto","source":"none","checked_at":"2026-10-22T05:01:00.000Z"}
```

Provider outage retains previously supported ON, subject to midnight expiration:

```json
{"beam_on":true,"verified":false,"last_win":"2026-10-21","mode":"auto","source":"balldontlie","checked_at":"2026-10-22T05:00:00.000Z"}
```

Manual-only mode with an active manual ON (always unverified):

```json
{"beam_on":true,"verified":false,"last_win":null,"mode":"manual_only","source":"manual","checked_at":null}
```

Missing/unavailable/corrupt D1, schema or environment identity returns **HTTP 503**:

```json
{"error":"service_unavailable"}
```

Unknown paths and unsupported methods return 404 with `{"error":"not_found"}`.
Raw upstream errors, URLs, scores, game identifiers and owner identities are never
included in this contract.

## Timing and confidence

Automatic and manual ON expire on every read at the relevant Pacific midnight,
without relying on Cron. Named IANA timezone conversion handles 23/25-hour days.
Neither adapter treats scheduled start or `last_update` as actual completion.
When a trustworthy start and first final observation are on the same Pacific day,
the completion **date** is bounded to that day; no exact completion instant is invented.
A midnight-spanning interval remains uncertain until explicitly resolved with
audited evidence. A stale nonfinal observation is not a trustworthy lower bound.

Single-source historical finals do not block future verification. Unresolved games
that may affect today's status, relevant source failures, incomplete coverage and
expired freshness lower confidence. Old backfill never reactivates expired ON.
Existing uncontested stored evidence survives source disabling, but disabling either
source prevents current `verified:true`. A same-day loss never erases another valid win.
