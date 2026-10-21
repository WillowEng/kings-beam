-- Reject incident updates computed from evidence that has since changed.
ALTER TABLE game_projection ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER revise_evidence AFTER INSERT ON provider_observations BEGIN
 UPDATE game_projection SET revision=revision+1 WHERE game_id=NEW.game_id;
END;
