import { AccountStatus, AccountStatusLookup, MfaLookup, Role } from '../../auth/auth.types';

/** What an admin may see about an account. Deliberately excludes tokens, secrets and raw attributes. */
export interface UserSummary {
  id: string;
  email: string | null;
  emailVerified: boolean;
  status: string; // CONFIRMED, FORCE_CHANGE_PASSWORD, EXTERNAL_PROVIDER, ...
  enabled: boolean;
  /** Set by admins in this app; independent of the Cognito status above. */
  accountStatus: AccountStatus;
  groups: Role[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserDetail extends UserSummary {
  mfaMethods: string[]; // e.g. SOFTWARE_TOKEN_MFA
  preferredMfa: string | null;
  identityProvider: string; // "Cognito" or e.g. "Google"
}

export type RoleFilter = 'all' | Role;

export interface UserPage {
  users: UserSummary[];
  nextToken: string | null;
}

/** Abstracts the identity store so the API can be tested without AWS. */
export interface UserDirectory extends AccountStatusLookup, MfaLookup {
  listUsers(opts: { filter: RoleFilter; nextToken?: string }): Promise<UserPage>;
  getUser(id: string): Promise<UserDetail | null>;
  /** Moves the account to `status`; for inactive/deleted also revokes its sessions. */
  setStatus(id: string, status: AccountStatus): Promise<void>;
  /**
   * Creates an account with the `user` role. Cognito generates a temporary
   * password and emails it; the API never sees it. Throws UserExistsError.
   */
  createUser(email: string): Promise<UserDetail>;
  /** Emails a fresh temporary password to a user who hasn't signed in yet. */
  resendInvite(id: string): Promise<void>;
  /** Removes the account from the pool for good (used to replace a soft-deleted one). */
  purgeUser(id: string): Promise<void>;
}

export class UserExistsError extends Error {
  constructor() {
    super('An account with this email already exists');
  }
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
