import type { UserSummary } from '../../api/types';

export type UserAction = 'deactivate' | 'reactivate' | 'delete';

/** What an admin may do to this account. Mirrors the API's rules; the API still enforces them. */
export function availableActions(u: Pick<UserSummary, 'groups' | 'accountStatus'>): UserAction[] {
  if (u.groups.includes('admin')) return [];
  switch (u.accountStatus) {
    case 'active':
      return ['deactivate', 'delete'];
    case 'inactive':
      return ['reactivate', 'delete'];
    default:
      return [];
  }
}

export const ACTION_COPY: Record<UserAction, { label: string; confirm: string; done: string; danger: boolean }> = {
  deactivate: {
    label: 'Deactivate user',
    confirm:
      'They will be signed out everywhere. When they try to sign in, they will be asked to contact an administrator. You can reactivate them later.',
    done: 'User deactivated.',
    danger: false,
  },
  reactivate: {
    label: 'Reactivate user',
    confirm: 'They will be able to sign in and use the app again.',
    done: 'User reactivated.',
    danger: false,
  },
  delete: {
    label: 'Delete user',
    confirm:
      'They will be signed out everywhere and lose access permanently. When they try to sign in, they will be told their account was deleted and to contact an administrator. This cannot be undone from the console.',
    done: 'User deleted.',
    danger: true,
  },
};
