/** All activation gates are absent/closed in committed Wrangler configuration. */
export interface Env {
  readonly APP_ENV: "production" | "test";
  readonly DB?: D1Database;
  readonly OPERATIONS_ENABLED?: string;
  readonly ADMIN_ENABLED?: string;
  readonly ACCESS_ISSUER?: string;
  readonly ACCESS_AUDIENCE?: string;
  readonly ADMIN_OWNERS?: string;
  readonly ADMIN_ORIGIN?: string;
  readonly BALLDONTLIE_API_KEY?: string;
  readonly ODDS_API_KEY?: string;
  readonly HEALTHCHECKS_HEARTBEAT_URL?: string;
  readonly NOTIFICATIONS_ENABLED?: string;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_TO?: string;
  readonly EMAIL?: SendEmail;
}
