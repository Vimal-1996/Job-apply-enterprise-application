-- The user's Gmail, connected so job-related emails can be summarized and
-- linked to their jobs. Only summaries and Gmail IDs are kept here, never
-- email bodies; the refresh token is stored encrypted (AES-256-GCM).

CREATE TABLE gmail_connection (
  user_id           text PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  email             text NOT NULL,
  refresh_token_enc text NOT NULL,
  scopes            text NOT NULL,
  -- expired: Google no longer accepts the token (e.g. Testing mode's 7-day limit); the user reconnects.
  status            text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired')),
  sync_status       text NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'failed')),
  sync_run_id       text,
  sync_error        text,
  sync_started_at   timestamptz,
  last_synced_at    timestamptz,
  connected_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per email looked at, including ones Claude found aren't about a job
-- (kept so they aren't sent to Claude again; hidden in the inbox).
CREATE TABLE inbox_email (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  gmail_id         text NOT NULL,
  thread_id        text NOT NULL,
  from_name        text,
  from_address     text NOT NULL,
  subject          text NOT NULL,
  received_at      timestamptz NOT NULL,
  job_related      boolean NOT NULL,
  category         text NOT NULL,
  summary          text,
  action           text,
  action_due       text,
  company          text,
  job_id           text REFERENCES job (id) ON DELETE SET NULL,
  -- How the email was linked to the job: by Claude, by its Gmail thread, or by the user.
  link_source      text CHECK (link_source IS NULL OR link_source IN ('ai', 'thread', 'user')),
  -- A stage change the email suggests for its job, and what the user did with it.
  suggested_status text,
  suggestion_state text CHECK (suggestion_state IS NULL OR suggestion_state IN ('pending', 'accepted', 'dismissed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_id)
);

CREATE INDEX inbox_email_user ON inbox_email (user_id, received_at);
CREATE INDEX inbox_email_job ON inbox_email (job_id);

-- Where a stage change came from: null when the user made it, 'email' when they accepted an email's suggestion.
ALTER TABLE application_event ADD COLUMN source text;
