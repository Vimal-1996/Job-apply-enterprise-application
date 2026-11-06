import type { Role } from '../auth/roles';

export type AccountStatus = 'active' | 'inactive' | 'deleted';

export interface UserSummary {
  id: string;
  email: string | null;
  emailVerified: boolean;
  status: string;
  enabled: boolean;
  /** Set by admins in this app; separate from the Cognito status. */
  accountStatus: AccountStatus;
  groups: Role[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserDetail extends UserSummary {
  mfaMethods: string[];
  preferredMfa: string | null;
  identityProvider: string;
}

export interface UserPage {
  users: UserSummary[];
  nextToken: string | null;
}
