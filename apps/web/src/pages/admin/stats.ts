import type { UserSummary } from '../../api/types';

export interface UserStats {
  total: number;
  more: boolean; // true when there are more pages than the first one counted
  admins: number;
  users: number;
  active: number;
  pending: number;
  disabled: number;
}

export function computeStats(users: UserSummary[], more: boolean): UserStats {
  const active = users.filter((u) => u.enabled && (u.status === 'CONFIRMED' || u.status === 'EXTERNAL_PROVIDER'));
  return {
    total: users.length,
    more,
    admins: users.filter((u) => u.groups.includes('admin')).length,
    users: users.filter((u) => u.groups.includes('user')).length,
    active: active.length,
    pending: users.filter((u) => u.enabled && u.status === 'FORCE_CHANGE_PASSWORD').length,
    disabled: users.filter((u) => !u.enabled).length,
  };
}

/** Newest accounts first; accounts without a date go last. */
export function newest(users: UserSummary[], n: number): UserSummary[] {
  return [...users].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, n);
}
