import { useEffect, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { FullPage, Spinner } from '../components/ui';
import { groupsFromProfile, hasAnyRole, type Role } from './roles';

/** Route guard: sends anonymous users to Cognito and shows 403 for missing roles. */
export function RequireAuth({ roles = [], children }: { roles?: Role[]; children: ReactNode }) {
  const auth = useAuth();
  const needsLogin = !auth.isLoading && !auth.error && !auth.isAuthenticated;

  useEffect(() => {
    if (needsLogin) void auth.signinRedirect({ state: window.location.pathname });
  }, [needsLogin, auth]);

  if (auth.isLoading || needsLogin) {
    return (
      <FullPage>
        <Spinner />
        <p className="muted">{needsLogin ? 'Redirecting to sign in…' : 'Loading…'}</p>
      </FullPage>
    );
  }
  if (!hasAnyRole(groupsFromProfile(auth.user?.profile), roles)) {
    return (
      <FullPage>
        <div className="big-code">403</div>
        <h2>You don't have access to this page</h2>
        <p className="muted">It requires the {roles.join(' or ')} role. Ask an administrator if you need access.</p>
        <Link className="btn btn-primary" to="/">
          Back to dashboard
        </Link>
      </FullPage>
    );
  }
  return <>{children}</>;
}
