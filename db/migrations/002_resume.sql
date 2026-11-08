-- Users' uploaded resumes. The file itself is in the user-files S3 bucket at
-- s3_key; this row is the app's record of it. A row starts 'pending' when an
-- upload is requested and becomes 'ready' only after the API has verified the
-- stored file. Deleting a user's account row deletes their resume rows.
CREATE TABLE resume (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  s3_key       text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  is_current   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  uploaded_at  timestamptz
);

CREATE INDEX resume_user_created ON resume (user_id, created_at);
