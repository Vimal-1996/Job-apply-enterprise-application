import type { UserSummary } from '../../api/types';

export type UserAction = 'resend-invite' | 'deactivate' | 'reactivate' | 'delete';

/** What an admin may do to this account. Mirrors the API's rules; the API still enforces them. */
export function availableActions(u: Pick<UserSummary, 'groups' | 'accountStatus' | 'status'>): UserAction[] {
  if (u.groups.includes('admin')) return [];
  switch (u.accountStatus) {
    case 'active':
      return u.status === 'FORCE_CHANGE_PASSWORD' ? ['resend-invite', 'deactivate', 'delete'] : ['deactivate', 'delete'];
    case 'inactive':
      return ['reactivate', 'delete'];
    default:
      return [];
  }
}

export const ACTION_COPY: Record<UserAction, { label: string; confirm: string; done: string; danger: boolean }> = {
  'resend-invite': {
    label: 'Resend invitation',
    confirm: 'They will get a new email with a new temporary password, valid for 3 days. The previous one stops working.',
    done: 'Invitation sent.',
    danger: false,
  },
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
      'They will be signed out everywhere and lose access to this account. When they try to sign in, they will be told it was deleted. If they sign up again (or you add them again) with the same email, they start over with a fresh account.',
    done: 'User deleted.',
    danger: true,
  },
};
