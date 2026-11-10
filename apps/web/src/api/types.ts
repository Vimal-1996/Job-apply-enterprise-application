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

export type JobSource = 'linkedin' | 'indeed' | 'other' | 'pasted';
export type MatchStatus = 'matching' | 'ready' | 'failed';
export type MatchVerdict = 'strong' | 'good' | 'possible' | 'weak';
export type ApplicationStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';

export interface JobSummary {
  id: string;
  source: JobSource;
  url: string | null;
  applyUrl: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  matchStatus: MatchStatus;
  score: number | null;
  verdict: MatchVerdict | null;
  applicationStatus: ApplicationStatus;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface JobDetails {
  title: string;
  /** A short digest of the posting. Missing on jobs matched before it was added. */
  overview?: string;
  responsibilities?: string[];
  benefits?: string[];
  company: string | null;
  location: string | null;
  workMode: WorkMode | null;
  employmentType: string | null;
  seniority: string | null;
  salary: string | null;
  yearsRequired: number | null;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  visaSponsorship: 'offered' | 'not_offered' | 'not_stated';
  applyUrl: string | null;
}

export interface JobMatch {
  score: number;
  verdict: MatchVerdict;
  summary: string;
  strengths: string[];
  gaps: string[];
  dealbreakers: string[];
}

export interface JobView extends JobSummary {
  description: string;
  details: JobDetails | null;
  match: JobMatch | null;
  matchError: string | null;
  matchedAt: string | null;
  /** The profile changed after this job was matched, so the match may be out of date. */
  profileChanged: boolean;
  notes: string | null;
  timeline: { status: ApplicationStatus; at: string }[];
}

export type SuggestionKind = 'summary' | 'headline' | 'add_skill' | 'rewrite_bullet' | 'add_bullet';
export type Decision = 'pending' | 'accepted' | 'rejected';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  workIndex: number | null;
  bulletIndex: number | null;
  before: string | null;
  after: string;
  reason: string;
  source: 'resume' | 'needs_confirmation';
  question: string | null;
  decision: Decision;
  editedText: string | null;
}

export interface DraftView {
  status: 'none' | 'suggesting' | 'ready' | 'failed';
  suggestions: Suggestion[];
  roles: { title: string; company: string }[];
  error: string | null;
  suggestedAt: string | null;
  profileChanged: boolean;
  aiEnabled: boolean;
}
