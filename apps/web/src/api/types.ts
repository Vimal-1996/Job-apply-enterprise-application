import type { Role } from '../auth/roles';

export interface UserSummary {
  id: string;
  email: string | null;
  emailVerified: boolean;
  status: string;
  enabled: boolean;
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
