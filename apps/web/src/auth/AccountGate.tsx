import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { ACCOUNT_BLOCKED_EVENT, ApiError, apiGet, type BlockedCode } from '../api/client';
import { FullPage, Spinner } from '../components/ui';
import { signOut } from './signOut';

const NOTICE: Record<BlockedCode, { title: string; text: string }> = {
  ACCOUNT_INACTIVE: {
    title: 'Your account is inactive',
    text: 'An administrator has deactivated your account. Please contact your administrator to restore access.',
  },
  ACCOUNT_DELETED: {
    title: 'Your account has been deleted',
    text: 'An administrator has deleted your account. Please contact your administrator if you need access.',
  },
};

/**
 * Signing in with Cognito only proves who someone is; whether the account is
 * still allowed in is decided by the API. Right after sign-in this asks the
 * API (GET /me) once, and it also listens for any later API call reporting the
 * account blocked. A blocked user's tokens are dropped and they see a
 * "contact your administrator" notice instead of the app.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const sub = auth.user?.profile.sub;
  const token = auth.user?.access_token;
  const [checked, setChecked] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedCode | null>(null);

  useEffect(() => {
    const onBlocked = (e: Event) => setBlocked((e as CustomEvent<BlockedCode>).detail);
    window.addEventListener(ACCOUNT_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(ACCOUNT_BLOCKED_EVENT, onBlocked);
  }, []);

  // Check once per signed-in user, not on every silent token renewal.
  useEffect(() => {
    if (!sub || !token || checked === sub) return;
    let cancelled = false;
    apiGet('/me', token)
      .catch((e) => {
        // Only a definite "blocked" stops the app; other failures (API down)
        // are left for the pages to report.
        if (!(e instanceof ApiError && e.blocked)) console.warn('Account check failed', e);
      })
      .finally(() => !cancelled && setChecked(sub));
    return () => {
      cancelled = true;
    };
  }, [sub, token, checked]);

  useEffect(() => {
    if (blocked) void auth.removeUser(); // drop local tokens; they are useless now
  }, [blocked, auth]);

  if (blocked) {
    const n = NOTICE[blocked];
    return (
      <FullPage>
        <div className="big-code" aria-hidden>
          🔒
        </div>
        <h2>{n.title}</h2>
        <p className="muted" role="alert" style={{ maxWidth: 420 }}>
          {n.text}
        </p>
        <button
          className="btn btn-primary"
          // End the Cognito session too, so the next sign-in can use another account.
          onClick={() => void signOut(auth)}
        >
          Back to sign in
        </button>
      </FullPage>
    );
  }

  if (auth.isAuthenticated && checked !== sub) {
    return (
      <FullPage>
        <Spinner />
        <p className="muted">Checking your account…</p>
      </FullPage>
    );
  }
  return <>{children}</>;
}
