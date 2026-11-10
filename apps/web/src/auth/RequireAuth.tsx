import { useEffect, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { FullPage, Spinner } from '../components/ui';
import { NotFound } from '../pages/NotFound';
import { groupsFromProfile, hasAnyRole, type Role } from './roles';
import { useSigningOut } from './useSigningOut';

/**
 * Route guard: sends anonymous users to Cognito. For signed-in users missing a
 * role it shows 403, or a plain 404 when `hidden` is set so the page's
 * existence isn't revealed (used for admin pages).
 */
export function RequireAuth({
  roles = [],
  hidden = false,
  children,
}: {
  roles?: Role[];
  hidden?: boolean;
  children: ReactNode;
}) {
  const auth = useAuth();
  const signingOut = useSigningOut();
  // Never start a sign-in while signing out: it would race the logout redirect
  // and, with Cognito's session still alive, sign the user straight back in.
  const needsLogin = !signingOut && !auth.isLoading && !auth.error && !auth.isAuthenticated;

  useEffect(() => {
    // The query too, so a page that needs it (e.g. Gmail's return with its code) survives signing in.
    if (needsLogin) void auth.signinRedirect({ state: `${window.location.pathname}${window.location.search}` });
  }, [needsLogin, auth]);

  if (signingOut || auth.isLoading || needsLogin) {
    return (
      <FullPage>
        <Spinner />
        <p className="muted">{signingOut ? 'Signing out…' : needsLogin ? 'Redirecting to sign in…' : 'Loading…'}</p>
      </FullPage>
    );
  }
  if (!hasAnyRole(groupsFromProfile(auth.user?.profile), roles)) {
    if (hidden) return <NotFound />;
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
