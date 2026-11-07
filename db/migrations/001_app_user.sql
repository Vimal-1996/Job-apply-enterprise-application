-- One row per account. Cognito keeps credentials, MFA and the admin role;
-- this table is the app's own record of who exists and whether they may use
-- the app, so the API never has to call Cognito on every request.
CREATE TABLE app_user (
  id             text PRIMARY KEY,            -- Cognito user id (the `sub` claim)
  email          text NOT NULL UNIQUE,        -- always stored lower-case
  role           text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'inactive', 'deleted')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  signed_in_at   timestamptz,                 -- null until their first sign-in ("invited")
  CHECK (email = lower(email))
);

-- Admin directory: filter by role, page in email order.
CREATE INDEX app_user_role_email ON app_user (role, email);
