-- Jobs a user has added (by pasting the posting, optionally with its link) and
-- how well each matches their profile. The server never fetches LinkedIn or
-- Indeed; the link is kept to identify the job and link back to it.
-- Removed with the user's account.

CREATE TABLE job (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('linkedin', 'indeed', 'other', 'pasted')),
  -- The site's own job ID (LinkedIn, Indeed), used to spot a job added twice.
  external_id   text,
  url           text,
  description   text NOT NULL,
  -- The job's facts as read by Claude: title, company, location, skills, ...
  details       jsonb,
  -- The last matching: 'matching' while it runs, then 'ready' or 'failed'.
  match_status  text NOT NULL CHECK (match_status IN ('matching', 'ready', 'failed')),
  -- Identifies the matching in progress, so a slow, superseded one can't overwrite a newer one.
  run_id        text,
  match         jsonb,
  match_error   text,
  matched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_user_created ON job (user_id, created_at);
CREATE INDEX job_user_external ON job (user_id, source, external_id);
