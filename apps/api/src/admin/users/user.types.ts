import { Role } from '../../auth/auth.types';

/** What an admin may see about an account. Deliberately excludes tokens, secrets and raw attributes. */
export interface UserSummary {
  id: string;
  email: string | null;
  emailVerified: boolean;
  status: string; // CONFIRMED, FORCE_CHANGE_PASSWORD, EXTERNAL_PROVIDER, ...
  enabled: boolean;
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
export interface UserDirectory {
  listUsers(opts: { filter: RoleFilter; nextToken?: string }): Promise<UserPage>;
  getUser(id: string): Promise<UserDetail | null>;
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
