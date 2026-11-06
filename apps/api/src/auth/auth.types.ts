export type Role = 'admin' | 'user';

/**
 * Lifecycle of an account, stored as Cognito group membership so it can't be
 * self-edited: no group = active, `inactive` group, or `deleted` group.
 * Deleted is a soft delete: the record is kept so a returning user can be
 * told to contact an administrator (and a Google user isn't silently re-created).
 */
export type AccountStatus = 'active' | 'inactive' | 'deleted';
export const STATUS_GROUPS = { inactive: 'inactive', deleted: 'deleted' } as const;

export interface AuthUser {
  /** Cognito user id (the `sub` claim). */
  id: string;
  groups: Role[];
  clientId: string;
}

/** Verifies a bearer token and returns its claims. Injectable so tests can fake it. */
export interface TokenVerifier {
  verify(token: string): Promise<{ sub: string; 'cognito:groups'?: string[]; client_id: string }>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/** Looks up an account's current status (the token alone may be up to an hour stale). */
export interface AccountStatusLookup {
  statusOf(userId: string): Promise<AccountStatus>;
}

export const ACCOUNT_STATUS = Symbol('ACCOUNT_STATUS');

/** Error codes the web app recognises to show "contact your administrator". */
export const BLOCKED: Record<Exclude<AccountStatus, 'active'>, { code: string; message: string }> = {
  inactive: {
    code: 'ACCOUNT_INACTIVE',
    message: 'Your account has been deactivated. Please contact your administrator.',
  },
  deleted: {
    code: 'ACCOUNT_DELETED',
    message: 'Your account has been deleted. Please contact your administrator.',
  },
};

/** Status implied by a set of raw Cognito group names. Deleted wins over inactive. */
export function statusFromGroups(groups: readonly string[]): AccountStatus {
  if (groups.includes(STATUS_GROUPS.deleted)) return 'deleted';
  if (groups.includes(STATUS_GROUPS.inactive)) return 'inactive';
  return 'active';
}
