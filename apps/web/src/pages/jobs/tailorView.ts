import type { DraftView, Suggestion } from '../../api/types';

/** What a suggestion changes, e.g. "Experience · Engineer, Globex · reworded bullet". */
export function suggestionLabel(s: Suggestion, roles: DraftView['roles']): string {
  const role = s.workIndex === null ? null : roles[s.workIndex];
  const where = role ? `Experience · ${role.title}, ${role.company}` : 'Experience';
  switch (s.kind) {
    case 'summary':
      return 'Summary';
    case 'headline':
      return 'Headline';
    case 'add_skill':
      return 'Skills · new skill';
    case 'rewrite_bullet':
      return `${where} · reworded bullet`;
    case 'add_bullet':
      return `${where} · new bullet`;
  }
}

/** Whether a job applies through Workday (its links are on a Workday site). */
export function isWorkdayJob(job: { url: string | null; applyUrl?: string | null; details?: { applyUrl: string | null } | null }): boolean {
  return [job.url, job.applyUrl, job.details?.applyUrl].some((u) => {
    try {
      return Boolean(u) && /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/i.test(new URL(u!).hostname);
    } catch {
      return false;
    }
  });
}

/** The text that would go on the resume: the user's edit, or Claude's wording. */
export const finalText = (s: Suggestion) => s.editedText ?? s.after;

export function counts(suggestions: Suggestion[]) {
  return {
    accepted: suggestions.filter((s) => s.decision === 'accepted').length,
    rejected: suggestions.filter((s) => s.decision === 'rejected').length,
    pending: suggestions.filter((s) => s.decision === 'pending').length,
  };
}

/** Claude's suggestions, without the lines written from the user's answers to gaps (shown with the gaps). */
export const ownSuggestions = (suggestions: Suggestion[]) => suggestions.filter((s) => !s.gapId);

/**
 * Where the user is: what's still to review before the resume can be
 * generated, and how many changes (suggestions and gap answers) it will have.
 */
export function tailorProgress(draft: Pick<DraftView, 'suggestions' | 'gaps'>) {
  const pendingSuggestions = ownSuggestions(draft.suggestions).filter((s) => s.decision === 'pending').length;
  const pendingGaps = draft.gaps.filter((g) => g.answer === 'pending').length;
  return {
    pendingSuggestions,
    pendingGaps,
    accepted: draft.suggestions.filter((s) => s.decision === 'accepted').length,
    done: pendingSuggestions === 0 && pendingGaps === 0,
  };
}

/** "3 suggestions and 1 gap", for what's left to review. */
export function leftToReview(p: { pendingSuggestions: number; pendingGaps: number }): string {
  const parts = [];
  if (p.pendingSuggestions) parts.push(`${p.pendingSuggestions} suggestion${p.pendingSuggestions === 1 ? '' : 's'}`);
  if (p.pendingGaps) parts.push(`${p.pendingGaps} gap${p.pendingGaps === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

/**
 * "Accept all" covers only pending suggestions backed by the resume. Anything
 * that needs confirmation (a skill the profile doesn't show) must be confirmed
 * one by one, so nothing untrue gets added in bulk.
 */
export const acceptAllIds = (suggestions: Suggestion[]) =>
  suggestions.filter((s) => s.decision === 'pending' && s.source === 'resume').map((s) => s.id);

export type FileFormat = 'docx' | 'pdf';
export const FILE_FORMATS: { value: FileFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (.docx)' },
];

/** The download address for a resume in the chosen format (and, for a job, layout). */
export function documentUrl(path: string, opts: { format: FileFormat; workday?: boolean }): string {
  const q = new URLSearchParams();
  if (opts.format !== 'docx') q.set('format', opts.format);
  if (opts.workday) q.set('layout', 'workday');
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Suggestions start on their own when the page opens, unless they exist already or can't be made yet. */
export const shouldAutoStart = (draft: Pick<DraftView, 'status' | 'aiEnabled'>, job: { details: unknown }) =>
  draft.status === 'none' && draft.aiEnabled && Boolean(job.details);

/** "+12", "0", "−5", with a tone: better, the same, or worse. */
export function scoreDelta(before: number, after: number): { text: string; tone: 'success' | 'neutral' | 'danger' } {
  const d = after - before;
  if (d > 0) return { text: `+${d}`, tone: 'success' };
  if (d < 0) return { text: `−${-d}`, tone: 'danger' };
  return { text: '±0', tone: 'neutral' };
}
