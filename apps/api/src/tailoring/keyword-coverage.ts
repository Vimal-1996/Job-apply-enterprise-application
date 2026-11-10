import { CandidateProfile } from '../profile/profile.schema';

/*
 * How many of the job's required skills a resume mentions, the way a simple
 * applicant tracking system (ATS) filter checks: by the words on the page, not
 * by judgment. Free and instant, so it's shown without asking.
 */

export interface KeywordCoverage {
  total: number;
  /** Required skills the original resume mentions. */
  original: number;
  tailored: number;
  /** Mentioned only after tailoring. */
  added: string[];
  /** Still not mentioned. */
  missing: string[];
}

/** Everything on the resume an ATS reads, as one lowercase, normalised string. */
export function resumeText(p: CandidateProfile): string {
  const parts = [
    p.headline,
    p.summary,
    ...p.skills,
    ...p.workHistory.flatMap((w) => [w.title, ...w.highlights]),
    ...p.education.flatMap((e) => [e.degree, e.field]),
    ...p.certifications,
    ...p.languages,
  ];
  return normalise(parts.filter(Boolean).join(' \n '));
}

/** Lowercase; letters, digits and the symbols that matter in tech names (+ # .) kept; a full stop ending a word dropped. */
function normalise(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/**
 * The ways a skill can be written: "Amazon Web Services (AWS)" counts as
 * either name, "CI/CD" as written or as "CI CD", and a plural matches its singular.
 */
export function skillVariants(skill: string): string[] {
  const out = new Set<string>();
  const add = (v: string) => {
    const n = normalise(v).trim();
    if (n.length < 1) return;
    out.add(n);
    if (n.length > 3 && n.endsWith('s') && !n.endsWith('ss')) out.add(n.slice(0, -1));
  };
  add(skill);
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(skill);
  if (paren) {
    add(paren[1]);
    add(paren[2]);
  }
  return [...out];
}

export function mentions(text: string, skill: string): boolean {
  return skillVariants(skill).some((v) => text.includes(` ${v} `) || text.includes(` ${v}s `));
}

export function keywordCoverage(required: string[], original: CandidateProfile, tailored: CandidateProfile): KeywordCoverage {
  const skills = [...new Map(required.map((s) => [s.trim().toLowerCase(), s.trim()])).values()].filter(Boolean).slice(0, 30);
  const before = resumeText(original);
  const after = resumeText(tailored);
  const had = skills.filter((s) => mentions(before, s));
  const has = skills.filter((s) => mentions(after, s));
  return {
    total: skills.length,
    original: had.length,
    tailored: has.length,
    added: has.filter((s) => !had.includes(s)),
    missing: skills.filter((s) => !has.includes(s)),
  };
}
