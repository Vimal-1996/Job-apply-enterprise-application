import { z } from 'zod';

/*
 * What Claude returns for one job posting: the job's facts as the posting
 * states them, and how well it matches the candidate. Plain types only, since
 * structured outputs support a subset of JSON Schema; ranges are enforced after
 * parsing (see `tidyAnalysis`).
 */

export const JobDetailsSchema = z.object({
  title: z.string().describe('the job title as written'),
  overview: z.string().describe('one or two plain sentences on what the role is and what the team or company does; no marketing language'),
  responsibilities: z
    .array(z.string())
    .describe('the main duties, at most 6, each a short phrase; leave out boilerplate'),
  benefits: z
    .array(z.string())
    .describe('perks the posting states, at most 6, each a short phrase (e.g. "Equity", "4-day week"); leave out generic claims'),
  company: z.string().nullable().describe('the hiring company, if named'),
  location: z.string().nullable(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable().describe('null if the posting does not say'),
  employmentType: z.string().nullable().describe('e.g. "Full-time", "Contract"; null if not stated'),
  seniority: z.string().nullable().describe('e.g. "Senior", "Staff"; null if not stated'),
  salary: z.string().nullable().describe('pay exactly as stated in the posting, e.g. "$120k–$150k + equity"; null if not stated'),
  yearsRequired: z.number().nullable().describe('minimum years of experience asked for; null if not stated'),
  requiredSkills: z.array(z.string()).describe('skills, tools and qualifications the posting requires'),
  niceToHaveSkills: z.array(z.string()).describe('skills the posting lists as a plus or preferred'),
  visaSponsorship: z.enum(['offered', 'not_offered', 'not_stated']),
  applyUrl: z
    .string()
    .nullable()
    .describe("a link to apply on the company's own careers site, only if one appears in the text; never invent one"),
});

export const MatchSchema = z.object({
  score: z.number().int().describe('0–100: how well the candidate fits this job, with dealbreakers pulling it down'),
  verdict: z.enum(['strong', 'good', 'possible', 'weak']),
  summary: z.string().describe("two or three sentences on the fit, addressed to the candidate as 'you'"),
  strengths: z.array(z.string()).describe('where the candidate clearly meets what the job asks, citing their experience'),
  gaps: z.array(z.string()).describe('requirements the profile does not show; say "not shown in your profile" rather than assume they lack it'),
  dealbreakers: z
    .array(z.string())
    .describe("conflicts with the candidate's stated preferences: location, work arrangement, salary, sponsorship, excluded companies"),
});

export const JobAnalysisSchema = z.object({
  isJobPosting: z.boolean().describe('false if the text is not a job posting (for example a login page or an error message)'),
  job: JobDetailsSchema,
  match: MatchSchema,
});

export type JobDetails = z.infer<typeof JobDetailsSchema>;
export type JobMatch = z.infer<typeof MatchSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

const LIST_MAX = 30;
/** Points shown as a digest of the posting. */
const DIGEST_MAX = 6;
const TEXT_MAX = 2000;

/** Clamps the score and trims runaway lists and strings, so stored analyses stay small and sane. */
export function tidyAnalysis(a: JobAnalysis): JobAnalysis {
  const text = (s: string) => s.slice(0, TEXT_MAX);
  const list = (xs: string[]) => xs.slice(0, LIST_MAX).map(text);
  const orNull = (s: string | null) => (s === null ? null : text(s));
  const applyUrl = a.job.applyUrl && /^https?:\/\//i.test(a.job.applyUrl) ? text(a.job.applyUrl) : null;
  return {
    isJobPosting: a.isJobPosting,
    job: {
      ...a.job,
      title: text(a.job.title),
      overview: text(a.job.overview),
      responsibilities: a.job.responsibilities.slice(0, DIGEST_MAX).map(text),
      benefits: a.job.benefits.slice(0, DIGEST_MAX).map(text),
      company: orNull(a.job.company),
      location: orNull(a.job.location),
      employmentType: orNull(a.job.employmentType),
      seniority: orNull(a.job.seniority),
      salary: orNull(a.job.salary),
      requiredSkills: list(a.job.requiredSkills),
      niceToHaveSkills: list(a.job.niceToHaveSkills),
      applyUrl,
    },
    match: {
      ...a.match,
      score: Math.max(0, Math.min(100, Math.round(a.match.score))),
      summary: text(a.match.summary),
      strengths: list(a.match.strengths),
      gaps: list(a.match.gaps),
      dealbreakers: list(a.match.dealbreakers),
    },
  };
}
