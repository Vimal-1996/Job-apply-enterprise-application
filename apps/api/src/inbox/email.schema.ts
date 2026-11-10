import { z } from 'zod';
import { ApplicationStatus } from '../jobs/job-store';

/*
 * What Claude returns for a batch of emails: for each, what kind of job email
 * it is, a short summary, what (if anything) the user must do, and which of the
 * user's jobs it's about. Plain types only (structured outputs support a subset
 * of JSON Schema); limits are applied after parsing (see `tidyVerdicts`).
 */

export const EMAIL_CATEGORIES = [
  'application_received',
  'interview',
  'assessment',
  'rejection',
  'offer',
  'recruiter_outreach',
  'job_alert',
  'other_job',
  'not_job',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EmailVerdictSchema = z.object({
  emails: z.array(
    z.object({
      ref: z.number().describe('the number of the email, as given'),
      category: z
        .enum(EMAIL_CATEGORIES)
        .describe(
          'application_received: confirms an application was received; interview: invites to or schedules an interview or call; assessment: a test or take-home to complete; rejection: the application is not going ahead; offer: a job offer; recruiter_outreach: a recruiter reaching out about a role; job_alert: a list of suggested jobs; other_job: any other email about the candidate\'s job search; not_job: not about the candidate\'s job search',
        ),
      summary: z.string().describe('two or three plain sentences on what the email says; for not_job, an empty string'),
      action: z.string().nullable().describe('what the candidate needs to do, in a short phrase (e.g. "Pick an interview slot"); null if nothing'),
      actionDue: z.string().nullable().describe('the deadline for that action as YYYY-MM-DD, only if the email states one; else null'),
      company: z.string().nullable().describe('the hiring company the email is about, if clear'),
      jobRef: z
        .number()
        .nullable()
        .describe("the number of the candidate's saved job this email is about; null if none matches or you are unsure"),
    }),
  ),
});
export type EmailVerdicts = z.infer<typeof EmailVerdictSchema>;
export type EmailVerdict = EmailVerdicts['emails'][number];

export const SUMMARY_MAX = 600;
const ACTION_MAX = 200;

const clip = (s: string | null, n: number) => (s ? s.trim().slice(0, n) || null : null);

/**
 * Keeps one verdict per email the batch actually had, with job references
 * that point at a real job, and text cut to size.
 */
export function tidyVerdicts(v: EmailVerdicts, emailCount: number, jobCount: number): Map<number, EmailVerdict> {
  const out = new Map<number, EmailVerdict>();
  for (const e of v.emails) {
    if (!Number.isInteger(e.ref) || e.ref < 1 || e.ref > emailCount || out.has(e.ref)) continue;
    const jobRef = e.jobRef !== null && Number.isInteger(e.jobRef) && e.jobRef >= 1 && e.jobRef <= jobCount ? e.jobRef : null;
    const notJob = e.category === 'not_job';
    out.set(e.ref, {
      ref: e.ref,
      category: e.category,
      summary: notJob ? '' : (clip(e.summary, SUMMARY_MAX) ?? ''),
      action: notJob ? null : clip(e.action, ACTION_MAX),
      actionDue: !notJob && e.actionDue && /^\d{4}-\d{2}-\d{2}$/.test(e.actionDue.trim()) ? e.actionDue.trim() : null,
      company: clip(e.company, 120),
      jobRef: notJob ? null : jobRef,
    });
  }
  return out;
}

/** The stage an email of this kind points to, if any. */
export function statusForCategory(c: EmailCategory): ApplicationStatus | null {
  switch (c) {
    case 'application_received':
      return 'applied';
    case 'interview':
    case 'assessment':
      return 'interviewing';
    case 'offer':
      return 'offer';
    case 'rejection':
      return 'rejected';
    default:
      return null;
  }
}

const ORDER: Partial<Record<ApplicationStatus, number>> = { saved: 0, applied: 1, interviewing: 2, offer: 3 };

/**
 * Whether moving a job from `current` to `target` is worth suggesting: only
 * forward along saved → applied → interviewing → offer, or to rejected from an
 * open stage. Never reopens a closed job, and never suggests where it already is.
 */
export function worthSuggesting(target: ApplicationStatus | null, current: ApplicationStatus): boolean {
  if (!target || target === current) return false;
  if (current === 'rejected' || current === 'withdrawn') return false;
  if (target === 'rejected') return current !== 'offer';
  const t = ORDER[target];
  const c = ORDER[current];
  return t !== undefined && c !== undefined && t > c;
}
