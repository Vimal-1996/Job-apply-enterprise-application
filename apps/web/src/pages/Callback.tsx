import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useNavigate } from 'react-router-dom';
import { FullPage, Spinner } from '../components/ui';

/** Landing spot after Cognito; returns the user to where they were heading. */
export function Callback() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isAuthenticated) {
      const target = typeof auth.user?.state === 'string' && auth.user.state.startsWith('/') ? auth.user.state : '/';
      navigate(target, { replace: true });
    }
  }, [auth.isAuthenticated, auth.user, navigate]);

  if (auth.error) {
    return (
      <FullPage>
        <h2>We couldn't sign you in</h2>
        <p className="muted">{auth.error.message}</p>
        <Link className="btn btn-primary" to="/">
          Try again
        </Link>
      </FullPage>
    );
  }
  return (
    <FullPage>
      <Spinner />
      <p className="muted">Signing you in…</p>
    </FullPage>
  );
}
