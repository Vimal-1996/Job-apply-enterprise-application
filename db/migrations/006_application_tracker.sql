-- Tracks where the user is with each job: saved, applied, interviewing, offer,
-- or closed (rejected / withdrawn), with private notes and a timeline of
-- status changes. Existing jobs start as 'saved'.

ALTER TABLE job ADD COLUMN application_status text NOT NULL DEFAULT 'saved'
  CHECK (application_status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'));
ALTER TABLE job ADD COLUMN notes text;
-- When the status last changed (null: still the initial 'saved').
ALTER TABLE job ADD COLUMN status_changed_at timestamptz;

-- One row per status change, for the job's timeline. Removed with the job.
CREATE TABLE application_event (
  id         text PRIMARY KEY,
  job_id     text NOT NULL REFERENCES job (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  status     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_event_job ON application_event (job_id, created_at);
