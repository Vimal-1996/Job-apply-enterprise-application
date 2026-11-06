import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { apiGet } from '../../api/client';
import type { UserPage, UserSummary } from '../../api/types';
import { computeStats, type UserStats } from './stats';

export { newest } from './stats';

/** Loads the first page of the user directory and derives headline numbers. */
export function useUserStats() {
  const auth = useAuth();
  const [state, setState] = useState<{ users: UserSummary[]; stats: UserStats } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<UserPage>('/admin/users?filter=all', auth.user?.access_token)
      .then(({ users, nextToken }) => !cancelled && setState({ users, stats: computeStats(users, Boolean(nextToken)) }))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [auth.user?.access_token]);

  return { users: state?.users ?? [], stats: state?.stats ?? null, loading: !state && !error, error };
}
