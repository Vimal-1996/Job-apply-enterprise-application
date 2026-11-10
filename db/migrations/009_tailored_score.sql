-- Scoring a tailored resume against its job: the original (base) resume and
-- the tailored one are matched again side by side, so the user sees whether
-- the accepted changes improve the fit. score_basis identifies the decisions
-- scored, so a score taken before the user changed them shows as out of date.
-- 'scoring', 'ready' or 'failed' (null: never scored). No CHECK: the in-memory test database can't add one to an existing table.
ALTER TABLE resume_draft ADD COLUMN score_status text;
ALTER TABLE resume_draft ADD COLUMN score_run_id text;
ALTER TABLE resume_draft ADD COLUMN score jsonb;
ALTER TABLE resume_draft ADD COLUMN score_error text;
ALTER TABLE resume_draft ADD COLUMN score_basis text;
ALTER TABLE resume_draft ADD COLUMN score_started_at timestamptz;
ALTER TABLE resume_draft ADD COLUMN scored_at timestamptz;

-- Runs are capped per kind: 'suggest' (making suggestions) and 'score'.
ALTER TABLE tailoring_run ADD COLUMN kind text NOT NULL DEFAULT 'suggest';
