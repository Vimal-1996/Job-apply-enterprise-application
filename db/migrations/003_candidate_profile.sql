-- A user's candidate profile: the structured facts from their resume (read by
-- AI, then reviewed and edited by the user), and their job preferences.
-- Both are removed with the user's account.

CREATE TABLE candidate_profile (
  user_id          text PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  -- The last reading of a resume: 'parsing' while it runs, then 'ready' or 'failed'.
  -- A failed reading keeps the previous profile.
  status           text NOT NULL CHECK (status IN ('parsing', 'ready', 'failed')),
  -- Identifies the reading in progress, so a slow, superseded one can't overwrite a newer one.
  run_id           text,
  source_resume_id text REFERENCES resume (id) ON DELETE SET NULL,
  source_file_name text,
  profile          jsonb,
  error            text,
  parsed_at        timestamptz,
  edited_at        timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_preferences (
  user_id     text PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
