/** No provider credentials or outbound service bindings are used by public reads. */
export interface Env {
  readonly APP_ENV: "production" | "test";
  readonly DB?: D1Database;
}
