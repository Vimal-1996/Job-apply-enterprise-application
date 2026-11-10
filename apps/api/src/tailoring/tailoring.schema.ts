import { z } from 'zod';
import { CandidateProfile } from '../profile/profile.schema';

/*
 * What Claude returns when tailoring a resume to a job: a list of proposed
 * changes to the candidate profile. Nothing is applied until the user accepts
 * it. Positions (workIndex, bulletIndex) refer to the profile Claude was shown,
 * which is stored with the suggestions. Plain types only (structured outputs);
 * everything is checked again in `tidySuggestions`.
 */

export const SUGGESTION_KINDS = ['summary', 'headline', 'add_skill', 'rewrite_bullet', 'add_bullet'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const RawSuggestionSchema = z.object({
  kind: z
    .enum(SUGGESTION_KINDS)
    .describe(
      'summary: replace the summary; headline: replace the headline; add_skill: add one skill; ' +
        'rewrite_bullet: reword one work-history bullet; add_bullet: add a bullet to one role',
    ),
  workIndex: z.number().int().nullable().describe('for rewrite_bullet and add_bullet: the role, as numbered in the profile; otherwise null'),
  bulletIndex: z.number().int().nullable().describe('for rewrite_bullet: the bullet within that role, as numbered; otherwise null'),
  after: z.string().describe('the new text: the summary, headline, skill name or bullet exactly as it should appear'),
  reason: z.string().describe('one sentence for the candidate on why this helps for this job, naming the posting term it targets'),
  source: z
    .enum(['resume', 'needs_confirmation'])
    .describe('resume: supported by the profile; needs_confirmation: the job wants it but the profile does not show it'),
  question: z
    .string()
    .nullable()
    .describe('for needs_confirmation: a yes/no question asking whether the candidate really has this; otherwise null'),
});

export const TailoringSchema = z.object({ suggestions: z.array(RawSuggestionSchema) });
export type RawSuggestion = z.infer<typeof RawSuggestionSchema>;

export type Decision = 'pending' | 'accepted' | 'rejected';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  workIndex: number | null;
  bulletIndex: number | null;
  /** The text being replaced (from the profile, not from Claude); null when adding. */
  before: string | null;
  after: string;
  reason: string;
  source: 'resume' | 'needs_confirmation';
  question: string | null;
  decision: Decision;
  /** The user's own wording, if they edited the suggestion before accepting. */
  editedText: string | null;
}

export const TAILORING_LIMITS = {
  /** Tailored-resume scorings per user per day (each matches two resumes). */
  scoresPerDay: 20, suggestions: 15, text: 1000, perDay: 20 };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, TAILORING_LIMITS.text);

/**
 * Turns Claude's suggestions into stored ones: drops anything pointing at a
 * role or bullet that doesn't exist, skills already listed, empty or repeated
 * text; fills in `before` from the profile; caps the count.
 */
export function tidySuggestions(profile: CandidateProfile, raw: RawSuggestion[], newId: () => string): Suggestion[] {
  const out: Suggestion[] = [];
  const skills = new Set(profile.skills.map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  for (const r of raw) {
    const after = clean(r.after);
    if (!after) continue;
    let before: string | null = null;
    let workIndex: number | null = null;
    let bulletIndex: number | null = null;
    if (r.kind === 'summary') before = profile.summary;
    else if (r.kind === 'headline') before = profile.headline;
    else if (r.kind === 'add_skill') {
      if (skills.has(after.toLowerCase())) continue;
      skills.add(after.toLowerCase());
    } else {
      const role = r.workIndex === null ? undefined : profile.workHistory[r.workIndex];
      if (!role) continue;
      workIndex = r.workIndex;
      if (r.kind === 'rewrite_bullet') {
        const bullet = r.bulletIndex === null ? undefined : role.highlights[r.bulletIndex];
        if (bullet === undefined) continue;
        bulletIndex = r.bulletIndex;
        before = bullet;
      }
    }
    if (before !== null && clean(before) === after) continue; // no actual change
    const key = `${r.kind}|${workIndex}|${bulletIndex}`;
    // One change per summary, headline or bullet; repeated additions are fine if the text differs.
    if (r.kind !== 'add_skill' && r.kind !== 'add_bullet' && seen.has(key)) continue;
    seen.add(key);
    const needsConfirmation = r.source === 'needs_confirmation';
    out.push({
      id: newId(),
      kind: r.kind,
      workIndex,
      bulletIndex,
      before,
      after,
      reason: clean(r.reason),
      source: r.source,
      question: needsConfirmation ? clean(r.question ?? '') || null : null,
      decision: 'pending',
      editedText: null,
    });
    if (out.length >= TAILORING_LIMITS.suggestions) break;
  }
  return out;
}

/** The profile with the accepted suggestions applied (in the user's wording if they edited one). */
export function applySuggestions(base: CandidateProfile, suggestions: Suggestion[]): CandidateProfile {
  const p: CandidateProfile = structuredClone(base);
  for (const s of suggestions) {
    if (s.decision !== 'accepted') continue;
    const text = s.editedText ?? s.after;
    switch (s.kind) {
      case 'summary':
        p.summary = text;
        break;
      case 'headline':
        p.headline = text;
        break;
      case 'add_skill':
        if (!p.skills.some((x) => x.toLowerCase() === text.toLowerCase())) p.skills.push(text);
        break;
      case 'rewrite_bullet':
        // Positions refer to the base profile; additions go after, so they never shift.
        if (s.workIndex !== null && s.bulletIndex !== null && p.workHistory[s.workIndex]) p.workHistory[s.workIndex].highlights[s.bulletIndex] = text;
        break;
      case 'add_bullet':
        if (s.workIndex !== null && p.workHistory[s.workIndex]) p.workHistory[s.workIndex].highlights.push(text);
        break;
    }
  }
  return p;
}

export interface DecisionUpdate {
  id: string;
  decision: Decision;
  editedText?: string | null;
}

/** Validates the body of PATCH .../resume-draft: `{ decisions: [{ id, decision, editedText? }] }`. */
export function parseDecisions(body: unknown): DecisionUpdate[] | { error: string } {
  const b = body as { decisions?: unknown } | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.decisions) || b.decisions.length === 0) return { error: 'Send the decisions to save' };
  if (b.decisions.length > TAILORING_LIMITS.suggestions) return { error: 'Too many decisions' };
  const out: DecisionUpdate[] = [];
  for (const d of b.decisions as Record<string, unknown>[]) {
    if (!d || typeof d.id !== 'string' || !['pending', 'accepted', 'rejected'].includes(d.decision as string)) {
      return { error: 'Each decision needs an id and one of: pending, accepted, rejected' };
    }
    let editedText: string | null | undefined;
    if (d.editedText !== undefined && d.editedText !== null) {
      if (typeof d.editedText !== 'string') return { error: 'editedText must be text' };
      editedText = clean(d.editedText);
      if (!editedText) return { error: "An edited suggestion can't be empty" };
      if (d.editedText.length > TAILORING_LIMITS.text) return { error: `Keep each edit under ${TAILORING_LIMITS.text} characters` };
    } else if (d.editedText === null) editedText = null;
    out.push({ id: d.id, decision: d.decision as Decision, editedText });
  }
  return out;
}
