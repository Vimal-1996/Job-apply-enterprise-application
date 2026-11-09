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

export interface Resume {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isCurrent: boolean;
  uploadedAt: string | null;
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  expiresInSeconds: number;
}

/** The shape the API stores; mirrors apps/api/src/profile/profile.schema.ts. */
export interface WorkEntry {
  title: string;
  company: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  highlights: string[];
}

export interface EducationEntry {
  institution: string;
  degree: string | null;
  field: string | null;
  endYear: number | null;
}

export interface CandidateProfile {
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
  summary: string | null;
  yearsExperience: number | null;
  skills: string[];
  workHistory: WorkEntry[];
  education: EducationEntry[];
  certifications: string[];
  languages: string[];
  workAuthorization: string | null;
}

export interface ProfileView {
  status: 'none' | 'parsing' | 'ready' | 'failed';
  profile: CandidateProfile | null;
  sourceFileName: string | null;
  parsedAt: string | null;
  editedAt: string | null;
  error: string | null;
  aiEnabled: boolean;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

export interface JobPreferences {
  targetTitles: string[];
  locations: string[];
  workModes: WorkMode[];
  minSalary: { amount: number; currency: string; period: 'year' | 'month' | 'hour' } | null;
  needsSponsorship: boolean | null;
  excludedCompanies: string[];
}
