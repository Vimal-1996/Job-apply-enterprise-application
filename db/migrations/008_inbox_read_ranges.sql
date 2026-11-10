-- The time ranges of the user's Gmail already read for job emails, merged
-- (e.g. [{"from": "...", "to": "..."}]), so picking a date range only reads
-- the parts not read before.
ALTER TABLE gmail_connection ADD COLUMN read_ranges jsonb NOT NULL DEFAULT '[]';
