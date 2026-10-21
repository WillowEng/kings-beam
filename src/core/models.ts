export const CATEGORIES = ["regular", "playoffs", "playin", "cup_regular", "cup_championship", "preseason", "summer_league"] as const;
export type Category = typeof CATEGORIES[number];
export type Competition = Category | "unknown";
export const PROVIDERS = ["balldontlie", "odds_api"] as const;
export type Provider = typeof PROVIDERS[number];
export type Scope = "production" | "test";
export type Lifecycle = "scheduled" | "in_progress" | "final" | "postponed" | "canceled" | "other" | "unknown";
export interface Observation {
  provider: Provider;
  providerGameId: string;
  home: string;
  away: string;
  season: number | null;
  scheduledStartAt: string | null;
  observedAt: string;
  lifecycle: Lifecycle;
  homeScore: number | null;
  awayScore: number | null;
  competition: Competition;
  classificationProvenance: string | null;
}
export interface Settings {
  eligibility: Record<Category, boolean>;
  enabled: Record<Provider, boolean>;
  priority: Provider[];
  requireDualAgreementForOn: boolean;
  manualOnly: boolean;
}
export function defaultSettings(): Settings {
  return {
    eligibility: { regular: true, playoffs: true, playin: true, cup_regular: true, cup_championship: true, preseason: true, summer_league: false },
    enabled: { balldontlie: true, odds_api: true }, priority: [...PROVIDERS],
    requireDualAgreementForOn: false, manualOnly: false,
  };
}
export function validateSettings(value: Settings): void {
  if (!value || Object.keys(value).sort().join() !== ["eligibility", "enabled", "priority", "requireDualAgreementForOn", "manualOnly"].sort().join() ||
    Object.keys(value.eligibility).sort().join() !== [...CATEGORIES].sort().join() ||
    Object.keys(value.enabled).sort().join() !== [...PROVIDERS].sort().join() ||
    [...Object.values(value.eligibility), ...Object.values(value.enabled), value.manualOnly, value.requireDualAgreementForOn].some(v => typeof v !== "boolean") ||
    value.priority.length !== 2 || new Set(value.priority).size !== 2 || value.priority.some(p => !PROVIDERS.includes(p)) ||
    (!value.manualOnly && !Object.values(value.enabled).some(Boolean))) throw new Error("invalid_settings");
}
export interface Game {
  id: string; home: string; away: string; season: number;
  revision: number;
  scheduledStartAt: string | null;
  observations: Observation[];
  actualCompletedAt: string | null;
}
export interface Coverage {
  day: string; categories: Category[]; sources: Provider[];
  complete: boolean; checkedAt: string; validUntil: string;
}
export interface Override { mode: "AUTO" | "FORCE_ON" | "FORCE_OFF"; createdAt: string; expiresAt: string | null }
export interface Snapshot {
  team: string; settings: Settings; games: Game[]; coverage: Coverage[];
  historyGaps?: Array<{ start: string; end: string }>;
  override: Override | null; failedSources: Provider[]; unmatchedRelevant?: boolean; checkedAt: string | null;
}
export interface PublicStatus {
  beam_on: boolean; verified: boolean; last_win: string | null;
  mode: "auto" | "manual_on" | "manual_off" | "manual_only";
  source: Provider | "dual" | "manual" | "none";
  checked_at: string | null;
}
