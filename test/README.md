# Local automated testing foundation

All helpers and fixtures here are test-only. They implement no Beam calculation,
eligibility decisions, provider adapters, database connections, or delivery service.
Run `npm test` for tests or `npm run check` for type-checking, both Wrangler dry-run
builds, and tests. No credentials or provider requests are needed.

## Organization

- `support/time.ts`: fixed UTC clock and Pacific formatting helpers; cleanup restores
  real timers after each test. There is no Beam-expiration calculation.
- `fixtures/time.ts`: synthetic summer/winter midnight instants, the spring skipped
  hour, fall repeated hour, and known 23/25-hour Pacific day intervals.
- `fixtures/providers.ts`: independently cloned synthetic provider envelopes,
  incomplete/empty/pending data, malformed scores, missing classification provenance,
  HTTP errors, API-level errors inside HTTP 200, and rate-limit/credit headers.
- `fixtures/observed-evidence.ts`: reduced reconstruction of selected Thunder/Spurs
  fields printed during prior Stage A validation on October 21, 2026. This is not a
  raw response archive or evidence of latency, completion time, or full coverage.
- `support/http.ts`: ordered in-memory HTTP responses, transport errors, abortable
  pending requests, and a fake-timer-compatible timeout helper. The matcher checks
  origin, path, method and sequence; it does not validate provider authentication.
  Unexpected requests fail closed. Safe call summaries exclude URLs, headers and bodies.
- `support/monitoring.ts`: per-environment heartbeat, incident opening/recovery,
  test-alert delivery and failed-delivery/retry doubles. There are no addresses,
  ping credentials, HTTP requests or actual emails; no outbox/deduplication logic.
- `support/diagnostics.ts`: synthetic credentials, a deliberately narrow diagnostic
  recorder that accepts only known provider/outcome codes and HTTP status, and a
  sensitive-output assertion whose errors do not echo leaked text.
- `unit/`: utilities and the unchanged Step 2 scaffold tests.
- `integration/`: fixture/transport integration, not live provider or D1 tests.
- `isolation/`: credential-output checks and independent fixture, diagnostic and
  monitoring instances. These are not proof of deployed Worker/D1 isolation.

## Offline and output protections

`setup.ts` blocks global fetch, Node HTTP(S) entry points, TCP socket connect, and
TLS connect before every test. Unexpected attempts are remembered and fail cleanup
even when their immediate exception was caught. Explicit mocks return memory-only
responses and never delegate to a real transport. The Node guards cover in-process
network access; they are not an operating-system sandbox for subprocesses.

The setup also captures console log/info/warn/error/debug output and checks it for
synthetic credential values, secret query parameters and Healthchecks ping URLs.
Tests cover plain and encoded secret text, URLs, headers, error messages and invalid
diagnostic fields. Intentional leak-detection tests call the assertion directly,
without printing unsafe text. Never populate these fixtures with real credentials.

Production logging does not exist yet. Its eventual implementation must be wired
to these checks; passing tests of this test-only recorder do not prove a future
logger safe. No test invokes live services or consumes API credits.
