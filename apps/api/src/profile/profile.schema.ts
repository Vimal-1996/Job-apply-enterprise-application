import { z } from 'zod';

/*
 * The candidate profile is both what Claude returns when it reads a resume
 * (structured output, so it always has this shape) and what the user edits.
 * Keep it to plain types: structured outputs support a subset of JSON Schema,
 * so limits on user edits are checked separately (see `checkProfileLimits`).
 */

export const WorkEntrySchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  startDate: z.string().nullable().describe('YYYY-MM, or YYYY if only the year is given; null if not stated'),
  endDate: z.string().nullable().describe('YYYY-MM or YYYY; null if this is the current role or not stated'),
  current: z.boolean().describe('true only if the resume indicates this is the current role'),
  highlights: z.array(z.string()).describe('achievements and responsibilities, close to the original wording'),
});

export const EducationEntrySchema = z.object({
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  endYear: z.number().int().nullable(),
});

export const CandidateProfileSchema = z.object({
  fullName: z.string().nullable(),
  headline: z.string().nullable().describe('current or most recent role in a few words, e.g. "Senior Backend Engineer"'),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable().describe('where the candidate is based, as stated'),
  links: z.array(z.string()).describe('URLs such as LinkedIn, GitHub or a portfolio'),
  summary: z.string().nullable().describe("the resume's own summary or objective, if it has one"),
  yearsExperience: z
    .number()
    .nullable()
    .describe('total years of professional experience, from the work history dates; null if unclear'),
  skills: z.array(z.string()).describe('concrete skills, technologies and tools named in the resume, without duplicates'),
  workHistory: z.array(WorkEntrySchema).describe('most recent first'),
  education: z.array(EducationEntrySchema),
  certifications: z.array(z.string()),
  languages: z.array(z.string()).describe('spoken languages'),
  workAuthorization: z
    .string()
    .nullable()
    .describe('work authorization or visa status, only if the resume states it'),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;

export const JobPreferencesSchema = z.object({
  targetTitles: z.array(z.string().trim().min(1).max(100)).max(20),
  locations: z.array(z.string().trim().min(1).max(100)).max(20),
  workModes: z.array(z.enum(WORK_MODES)).max(3),
  minSalary: z
    .object({
      amount: z.number().positive().max(100_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. USD'),
      period: z.enum(['year', 'month', 'hour']),
    })
    .nullable(),
  needsSponsorship: z.boolean().nullable(),
  excludedCompanies: z.array(z.string().trim().min(1).max(100)).max(100),
});

export type JobPreferences = z.infer<typeof JobPreferencesSchema>;

export const EMPTY_PREFERENCES: JobPreferences = {
  targetTitles: [],
  locations: [],
  workModes: [],
  minSalary: null,
  needsSponsorship: null,
  excludedCompanies: [],
};

/** Limits on a user-edited profile, so one user can't store megabytes of JSON. */
export const PROFILE_LIMITS = { jsonChars: 100_000, listItems: 100, textChars: 5_000 };

/** Returns a problem with the profile's size, or null if it's within limits. */
export function checkProfileLimits(p: CandidateProfile): string | null {
  if (JSON.stringify(p).length > PROFILE_LIMITS.jsonChars) return 'The profile is too large';
  const lists = [p.links, p.skills, p.workHistory, p.education, p.certifications, p.languages];
  if (lists.some((l) => l.length > PROFILE_LIMITS.listItems) || p.workHistory.some((w) => w.highlights.length > PROFILE_LIMITS.listItems)) {
    return `Lists can have at most ${PROFILE_LIMITS.listItems} items`;
  }
  const tooLong = (v: unknown): boolean =>
    typeof v === 'string' ? v.length > PROFILE_LIMITS.textChars : Array.isArray(v) ? v.some(tooLong) : v !== null && typeof v === 'object' ? Object.values(v).some(tooLong) : false;
  if (tooLong(p)) return `Text fields can be at most ${PROFILE_LIMITS.textChars} characters`;
  return null;
}

/** The first validation problem, in words a user can act on. */
export function describeZodError(e: z.ZodError): string {
  const issue = e.issues[0];
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`;
}
