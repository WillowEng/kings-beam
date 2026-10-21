PRAGMA foreign_keys = ON;
CREATE TABLE app_metadata (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL CHECK(scope IN ('production','test')), team TEXT NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL CHECK(json_valid(value)), last_command TEXT);
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE provider_team_ids (provider TEXT NOT NULL, provider_id TEXT NOT NULL, team TEXT NOT NULL REFERENCES teams(id), PRIMARY KEY(provider,provider_id));
CREATE TABLE team_aliases (alias TEXT PRIMARY KEY, team TEXT NOT NULL REFERENCES teams(id));
CREATE TABLE games (
  id TEXT PRIMARY KEY, home TEXT NOT NULL REFERENCES teams(id), away TEXT NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL, start_at TEXT, updated_at TEXT NOT NULL, actual_completed_at TEXT,
  CHECK(home<>away)
);
CREATE INDEX games_match ON games(home,away,start_at);
CREATE TABLE provider_game_ids (provider TEXT NOT NULL, provider_id TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id), PRIMARY KEY(provider,provider_id));
CREATE TABLE provider_observations (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), provider TEXT NOT NULL,
  provider_id TEXT NOT NULL, observed_at TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value))
);
CREATE INDEX observations_game_time ON provider_observations(game_id,observed_at);
CREATE TABLE unmatched_observations (id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE coverage (day TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE provider_failures (provider TEXT NOT NULL, day TEXT NOT NULL, code TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(provider,day));
CREATE TABLE overrides (command TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, mode TEXT NOT NULL CHECK(mode IN ('AUTO','FORCE_ON','FORCE_OFF')), created_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL CHECK(json_valid(detail)));
CREATE TABLE incidents (key TEXT PRIMARY KEY, kind TEXT NOT NULL, game_id TEXT, open INTEGER NOT NULL CHECK(open IN (0,1)), generation INTEGER NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE notification_outbox (id TEXT PRIMARY KEY, incident_key TEXT NOT NULL REFERENCES incidents(key), transition TEXT NOT NULL CHECK(transition IN ('open','recovery')), created_at TEXT NOT NULL, delivered_at TEXT);
CREATE TABLE quota_counters (provider TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, cap INTEGER NOT NULL CHECK(cap>=0), used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0), last_reservation TEXT, PRIMARY KEY(provider,period_start));
CREATE TRIGGER quota_no_overlap BEFORE INSERT ON quota_counters
WHEN EXISTS(SELECT 1 FROM quota_counters WHERE provider=NEW.provider AND period_start<>NEW.period_start AND period_start<NEW.period_end AND period_end>NEW.period_start)
BEGIN SELECT RAISE(ABORT,'overlapping_quota'); END;
CREATE TABLE request_reservations (id TEXT PRIMARY KEY, provider TEXT NOT NULL, at TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost>0));
CREATE INDEX reservations_time ON request_reservations(provider,at);
