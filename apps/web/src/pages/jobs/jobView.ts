import type { JobSource, JobSummary, MatchVerdict } from '../../api/types';

type Tone = 'success' | 'primary' | 'warning' | 'danger' | 'neutral';

/** The same limits the API enforces, checked here first so the user hears about them straight away. */
export const DESCRIPTION_MIN = 200;
export const DESCRIPTION_MAX = 50_000;

const VERDICT: Record<MatchVerdict, { label: string; tone: Tone }> = {
  strong: { label: 'Strong match', tone: 'success' },
  good: { label: 'Good match', tone: 'primary' },
  possible: { label: 'Possible match', tone: 'warning' },
  weak: { label: 'Weak match', tone: 'danger' },
};

export function verdictLabel(v: MatchVerdict): { label: string; tone: Tone } {
  return VERDICT[v];
}

const SOURCE: Record<JobSource, string> = { linkedin: 'LinkedIn', indeed: 'Indeed', other: 'Link', pasted: 'Pasted' };
export const sourceLabel = (s: JobSource) => SOURCE[s];

/** A job's name before (or without) Claude reading it. */
export function jobTitle(j: Pick<JobSummary, 'title' | 'company' | 'matchStatus'>): string {
  if (j.title) return j.title;
  return j.matchStatus === 'matching' ? 'Reading the job…' : 'Untitled job';
}

/** Checks the add-a-job form; returns the request body or a message for the user. */
export function newJobRequest(description: string): { body: { description: string } } | { error: string } {
  const d = description.trim();
  if (!d) return { error: 'Paste the job description.' };
  if (d.length < DESCRIPTION_MIN) return { error: 'Paste the full job description: this is too short to judge the job by.' };
  if (d.length > DESCRIPTION_MAX) return { error: `The job description is too long (over ${DESCRIPTION_MAX.toLocaleString('en')} characters).` };
  return { body: { description: d } };
}

/** Best matches first; jobs still being matched at the top, failed ones at the bottom; newest first within a group. */
export function sortJobs<T extends Pick<JobSummary, 'matchStatus' | 'score' | 'createdAt'>>(jobs: T[]): T[] {
  const rank = (j: T) => (j.matchStatus === 'matching' ? 0 : j.matchStatus === 'ready' ? 1 : 2);
  return [...jobs].sort(
    (a, b) => rank(a) - rank(b) || (b.score ?? -1) - (a.score ?? -1) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Only http(s) links are rendered as links. */
export const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);
