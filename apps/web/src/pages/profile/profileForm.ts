import type { CandidateProfile, JobPreferences, WorkMode } from '../../api/types';

/*
 * While editing, every field is a string (lists are one item per line), so
 * inputs stay simple. `fromDraft` turns the draft back into what the API takes.
 */

export interface WorkDraft {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  highlights: string;
}

export interface EducationDraft {
  institution: string;
  degree: string;
  field: string;
  endYear: string;
}

export interface ProfileDraft {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  summary: string;
  yearsExperience: string;
  skills: string;
  workHistory: WorkDraft[];
  education: EducationDraft[];
  certifications: string;
  languages: string;
  workAuthorization: string;
}

/** One item per line; blank lines and surrounding spaces dropped. */
export const toList = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Keeps the first spelling of each item, comparing case-insensitively. */
export function uniqueIgnoringCase(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

export const toLines = (list: string[]): string => list.join('\n');

const text = (v: string | null | undefined): string => v ?? '';
const orNull = (v: string): string | null => v.trim() || null;

export const EMPTY_WORK: WorkDraft = { title: '', company: '', location: '', startDate: '', endDate: '', current: false, highlights: '' };
export const EMPTY_EDUCATION: EducationDraft = { institution: '', degree: '', field: '', endYear: '' };

export function toDraft(p: CandidateProfile | null): ProfileDraft {
  return {
    fullName: text(p?.fullName),
    headline: text(p?.headline),
    email: text(p?.email),
    phone: text(p?.phone),
    location: text(p?.location),
    links: toLines(p?.links ?? []),
    summary: text(p?.summary),
    yearsExperience: p?.yearsExperience == null ? '' : String(p.yearsExperience),
    skills: toLines(p?.skills ?? []),
    workHistory: (p?.workHistory ?? []).map((w) => ({
      title: w.title,
      company: w.company,
      location: text(w.location),
      startDate: text(w.startDate),
      endDate: text(w.endDate),
      current: w.current,
      highlights: toLines(w.highlights),
    })),
    education: (p?.education ?? []).map((e) => ({
      institution: e.institution,
      degree: text(e.degree),
      field: text(e.field),
      endYear: e.endYear == null ? '' : String(e.endYear),
    })),
    certifications: toLines(p?.certifications ?? []),
    languages: toLines(p?.languages ?? []),
    workAuthorization: text(p?.workAuthorization),
  };
}

/** The draft as a profile, or the first problem in words the user can act on. */
export function fromDraft(d: ProfileDraft): { profile: CandidateProfile } | { error: string } {
  let years: number | null = null;
  if (d.yearsExperience.trim()) {
    years = Number(d.yearsExperience);
    if (!Number.isFinite(years) || years < 0 || years > 80) return { error: 'Years of experience must be a number from 0 to 80' };
  }

  const work = d.workHistory.filter((w) => w.title.trim() || w.company.trim() || w.highlights.trim());
  for (const [i, w] of work.entries()) {
    if (!w.title.trim() || !w.company.trim()) return { error: `Job ${i + 1}: enter both a job title and a company` };
  }

  const education = d.education.filter((e) => e.institution.trim() || e.degree.trim() || e.field.trim() || e.endYear.trim());
  const educationOut = [];
  for (const [i, e] of education.entries()) {
    if (!e.institution.trim()) return { error: `Education ${i + 1}: enter the school or university` };
    let endYear: number | null = null;
    if (e.endYear.trim()) {
      endYear = Number(e.endYear);
      if (!Number.isInteger(endYear) || endYear < 1900 || endYear > 2100) return { error: `Education ${i + 1}: enter the year as four digits, e.g. 2017` };
    }
    educationOut.push({ institution: e.institution.trim(), degree: orNull(e.degree), field: orNull(e.field), endYear });
  }

  return {
    profile: {
      fullName: orNull(d.fullName),
      headline: orNull(d.headline),
      email: orNull(d.email),
      phone: orNull(d.phone),
      location: orNull(d.location),
      links: toList(d.links),
      summary: orNull(d.summary),
      yearsExperience: years,
      skills: uniqueIgnoringCase(toList(d.skills)),
      workHistory: work.map((w) => ({
        title: w.title.trim(),
        company: w.company.trim(),
        location: orNull(w.location),
        startDate: orNull(w.startDate),
        endDate: w.current ? null : orNull(w.endDate),
        current: w.current,
        highlights: toList(w.highlights),
      })),
      education: educationOut,
      certifications: toList(d.certifications),
      languages: toList(d.languages),
      workAuthorization: orNull(d.workAuthorization),
    },
  };
}

export interface PreferencesDraft {
  targetTitles: string;
  locations: string;
  workModes: WorkMode[];
  salaryAmount: string;
  salaryCurrency: string;
  salaryPeriod: 'year' | 'month' | 'hour';
  /** '' = not said */
  needsSponsorship: '' | 'yes' | 'no';
  excludedCompanies: string;
}

export function toPreferencesDraft(p: JobPreferences): PreferencesDraft {
  return {
    targetTitles: toLines(p.targetTitles),
    locations: toLines(p.locations),
    workModes: p.workModes,
    salaryAmount: p.minSalary ? String(p.minSalary.amount) : '',
    salaryCurrency: p.minSalary?.currency ?? '',
    salaryPeriod: p.minSalary?.period ?? 'year',
    needsSponsorship: p.needsSponsorship == null ? '' : p.needsSponsorship ? 'yes' : 'no',
    excludedCompanies: toLines(p.excludedCompanies),
  };
}

export function fromPreferencesDraft(d: PreferencesDraft): { preferences: JobPreferences } | { error: string } {
  let minSalary: JobPreferences['minSalary'] = null;
  if (d.salaryAmount.trim()) {
    const amount = Number(d.salaryAmount.replace(/[,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Minimum salary must be a positive number' };
    const currency = d.salaryCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Enter the salary currency as a 3-letter code, e.g. USD or EUR' };
    minSalary = { amount, currency, period: d.salaryPeriod };
  }
  return {
    preferences: {
      targetTitles: toList(d.targetTitles),
      locations: toList(d.locations),
      workModes: d.workModes,
      minSalary,
      needsSponsorship: d.needsSponsorship === '' ? null : d.needsSponsorship === 'yes',
      excludedCompanies: toList(d.excludedCompanies),
    },
  };
}
