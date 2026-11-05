import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { hasAnyRole, groupsFromProfile, type Role } from './roles';

/** Route guard: sends anonymous users to Cognito, shows 403 for missing roles. */
export function RequireAuth({ roles = [], children }: { roles?: Role[]; children: ReactNode }) {
  const auth = useAuth();

  if (auth.isLoading) return <p>Loading…</p>;
  if (auth.error) return <p role="alert">Sign-in error: {auth.error.message}</p>;
  if (!auth.isAuthenticated) {
    void auth.signinRedirect({ state: window.location.pathname });
    return <p>Redirecting to sign in…</p>;
  }
  if (!hasAnyRole(groupsFromProfile(auth.user?.profile), roles)) {
    return <p role="alert">403: you do not have access to this page.</p>;
  }
  return <>{children}</>;
}
