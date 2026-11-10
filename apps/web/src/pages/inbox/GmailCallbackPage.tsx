import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiPost } from '../../api/client';
import { Spinner } from '../../components/ui';

/**
 * Where Google sends the user back after they allow (or refuse) Gmail access.
 * The code goes to the API with the signed-in user's token, so it can only be
 * attached to the account that started connecting.
 */
export function GmailCallbackPage() {
  const auth = useAuth();
  const token = auth.user?.access_token;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  /** The code works once; React's dev mode runs effects twice. */
  const sent = useRef(false);

  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');

  useEffect(() => {
    if (sent.current || denied || !code || !state || !token) return;
    sent.current = true;
    apiPost('/inbox/connect/finish', token, { code, state })
      .then(() => navigate('/inbox', { replace: true }))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not connect Gmail.'));
  }, [code, state, denied, token, navigate]);

  // Coming back from Google reloads the app; if the sign-in couldn't be renewed then,
  // sign in again and come straight back here (with Google's code) to finish.
  if (code && state && !error && !auth.isLoading && (auth.error || !token))
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Your sign-in expired while you were on Google's page. Sign in again to finish connecting Gmail.</p>
        <div>
          <button className="btn btn-primary" onClick={() => void auth.signinRedirect({ state: `${window.location.pathname}${window.location.search}` })}>
            Sign in and finish connecting
          </button>
        </div>
        <Link to="/inbox">Back to Inbox</Link>
      </div>
    );
  if (denied || (!code && !error))
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Gmail wasn't connected{denied === 'access_denied' ? ': you chose not to allow access' : ''}.
        </p>
        <Link to="/inbox">Back to Inbox</Link>
      </div>
    );
  if (error)
    return (
      <div className="card">
        <p role="alert" className="notice error">
          {error}
        </p>
        <Link to="/inbox">Back to Inbox</Link>
      </div>
    );
  return (
    <div className="center" style={{ minHeight: 160 }} role="status">
      <Spinner /> Connecting Gmail…
    </div>
  );
}
