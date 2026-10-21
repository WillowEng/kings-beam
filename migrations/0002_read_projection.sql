-- Transactional compact read projection; the complete append-only history remains intact.
CREATE INDEX observations_provider_time ON provider_observations(game_id,provider,observed_at);
CREATE INDEX observations_lifecycle ON provider_observations(game_id,json_extract(value,'$.lifecycle'),observed_at);
CREATE INDEX observations_category ON provider_observations(game_id,json_extract(value,'$.competition'),observed_at);
CREATE TABLE game_projection (game_id TEXT PRIMARY KEY REFERENCES games(id), observations TEXT NOT NULL CHECK(json_valid(observations)));
CREATE TRIGGER project_observation AFTER INSERT ON provider_observations BEGIN
 INSERT INTO game_projection(game_id,observations) VALUES(NEW.game_id,(SELECT json_group_array(json(value)) FROM (
 SELECT o.value FROM provider_observations o WHERE o.game_id=NEW.game_id AND (
   o.observed_at=(SELECT MAX(p.observed_at) FROM provider_observations p WHERE p.game_id=o.game_id AND p.provider=o.provider)
   OR o.id=(SELECT f.id FROM provider_observations f WHERE f.game_id=o.game_id AND json_extract(f.value,'$.lifecycle')='final' ORDER BY f.observed_at,f.id LIMIT 1)
   OR o.id=(SELECT n.id FROM provider_observations n WHERE n.game_id=o.game_id AND json_extract(n.value,'$.lifecycle')<>'final' AND n.observed_at<(SELECT MIN(f.observed_at) FROM provider_observations f WHERE f.game_id=o.game_id AND json_extract(f.value,'$.lifecycle')='final') ORDER BY n.observed_at DESC,n.id LIMIT 1)
   OR (json_extract(o.value,'$.competition')<>'unknown' AND o.id=(SELECT c.id FROM provider_observations c WHERE c.game_id=o.game_id AND json_extract(c.value,'$.competition')=json_extract(o.value,'$.competition') ORDER BY c.observed_at,c.id LIMIT 1))
 ) ORDER BY o.observed_at,o.id
)))
 ON CONFLICT(game_id) DO UPDATE SET observations=excluded.observations;
END;
INSERT INTO game_projection(game_id,observations) SELECT g.id,(SELECT json_group_array(json(value)) FROM (
 SELECT o.value FROM provider_observations o WHERE o.game_id=g.id AND (
   o.observed_at=(SELECT MAX(p.observed_at) FROM provider_observations p WHERE p.game_id=o.game_id AND p.provider=o.provider)
   OR o.id=(SELECT f.id FROM provider_observations f WHERE f.game_id=o.game_id AND json_extract(f.value,'$.lifecycle')='final' ORDER BY f.observed_at,f.id LIMIT 1)
   OR o.id=(SELECT n.id FROM provider_observations n WHERE n.game_id=o.game_id AND json_extract(n.value,'$.lifecycle')<>'final' AND n.observed_at<(SELECT MIN(f.observed_at) FROM provider_observations f WHERE f.game_id=o.game_id AND json_extract(f.value,'$.lifecycle')='final') ORDER BY n.observed_at DESC,n.id LIMIT 1)
   OR (json_extract(o.value,'$.competition')<>'unknown' AND o.id=(SELECT c.id FROM provider_observations c WHERE c.game_id=o.game_id AND json_extract(c.value,'$.competition')=json_extract(o.value,'$.competition') ORDER BY c.observed_at,c.id LIMIT 1))
 ) ORDER BY o.observed_at,o.id
)) FROM games g;
