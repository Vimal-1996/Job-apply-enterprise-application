-- Tailored resumes: for one job, Claude suggests changes to the user's resume
-- (from their profile); the user accepts, edits or rejects each one, and the
-- app builds a Word resume from the profile plus only the accepted changes.
-- One draft per job; tailoring again replaces it. Removed with the job or account.

CREATE TABLE resume_draft (
  job_id       text PRIMARY KEY REFERENCES job (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  -- 'suggesting' while Claude works, then 'ready' or 'failed'.
  status       text NOT NULL CHECK (status IN ('suggesting', 'ready', 'failed')),
  -- Identifies the run in progress, so a slow, superseded one can't overwrite a newer one.
  run_id       text,
  -- The profile the suggestions were made against: their positions refer to it.
  base_profile jsonb,
  -- The suggestions, each with the user's decision and any edit.
  suggestions  jsonb,
  -- Identifies the current set of suggestions: decisions are saved only against
  -- it, so a choice made on an old page can't land on a newer set.
  suggestions_id text,
  error        text,
  suggested_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resume_draft_user ON resume_draft (user_id);

-- One row per tailoring started, to cap Claude spend per user per day.
CREATE TABLE tailoring_run (
  user_id    text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tailoring_run_user_created ON tailoring_run (user_id, created_at);
