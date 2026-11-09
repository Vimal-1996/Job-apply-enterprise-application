import { describe, expect, it } from 'vitest';
import type { CandidateProfile } from '../../api/types';
import { EMPTY_EDUCATION, EMPTY_WORK, fromDraft, fromPreferencesDraft, toDraft, toList, toPreferencesDraft } from './profileForm';

const profile: CandidateProfile = {
  fullName: 'Jane Example',
  headline: 'Senior Backend Engineer',
  email: 'jane@example.com',
  phone: null,
  location: 'Dublin, Ireland',
  links: ['https://github.com/jane'],
  summary: null,
  yearsExperience: 8,
  skills: ['TypeScript', 'Go'],
  workHistory: [
    { title: 'Senior Backend Engineer', company: 'Acme', location: null, startDate: '2021', endDate: null, current: true, highlights: ['Led a migration'] },
  ],
  education: [{ institution: 'Trinity College Dublin', degree: 'BSc', field: 'Computer Science', endYear: 2017 }],
  certifications: [],
  languages: ['English'],
  workAuthorization: null,
};

describe('toList', () => {
  it('keeps one trimmed item per non-blank line', () => {
    expect(toList(' a \n\n b\r\n')).toEqual(['a', 'b']);
  });
});

describe('profile draft', () => {
  it('round-trips a profile unchanged', () => {
    expect(fromDraft(toDraft(profile))).toEqual({ profile });
  });

  it('starts empty with no profile', () => {
    const r = fromDraft(toDraft(null));
    expect('profile' in r && r.profile.workHistory).toEqual([]);
  });

  it('drops blank entries, de-duplicates skills and clears the end date of a current role', () => {
    const d = toDraft(profile);
    d.skills = 'Go\ngo\nSQL';
    d.workHistory = [{ ...d.workHistory[0], endDate: '2024' }, { ...EMPTY_WORK }];
    d.education.push({ ...EMPTY_EDUCATION });
    const r = fromDraft(d);
    if (!('profile' in r)) throw new Error(r.error);
    expect(r.profile.skills).toEqual(['Go', 'SQL']);
    expect(r.profile.workHistory).toHaveLength(1);
    expect(r.profile.workHistory[0].endDate).toBeNull();
    expect(r.profile.education).toHaveLength(1);
  });

  it('explains what to fix', () => {
    const d = toDraft(profile);
    expect(fromDraft({ ...d, yearsExperience: 'lots' })).toEqual({ error: expect.stringMatching(/Years of experience/) });
    expect(fromDraft({ ...d, workHistory: [{ ...EMPTY_WORK, title: 'Engineer' }] })).toEqual({ error: expect.stringMatching(/Job 1/) });
    expect(fromDraft({ ...d, education: [{ ...EMPTY_EDUCATION, institution: 'TCD', endYear: '17' }] })).toEqual({
      error: expect.stringMatching(/four digits/),
    });
  });
});

describe('preferences draft', () => {
  it('round-trips, reading "not said" as null', () => {
    const p = {
      targetTitles: ['Backend Engineer'],
      locations: ['Dublin'],
      workModes: ['remote' as const],
      minSalary: { amount: 90000, currency: 'EUR', period: 'year' as const },
      needsSponsorship: null,
      excludedCompanies: [],
    };
    expect(fromPreferencesDraft(toPreferencesDraft(p))).toEqual({ preferences: p });
  });

  it('accepts "90,000" and a lower-case currency, and rejects a bad currency', () => {
    const d = { ...toPreferencesDraft({ targetTitles: [], locations: [], workModes: [], minSalary: null, needsSponsorship: true, excludedCompanies: [] }) };
    const ok = fromPreferencesDraft({ ...d, salaryAmount: '90,000', salaryCurrency: 'eur' });
    expect(ok).toMatchObject({ preferences: { minSalary: { amount: 90000, currency: 'EUR' }, needsSponsorship: true } });
    expect(fromPreferencesDraft({ ...d, salaryAmount: '90000', salaryCurrency: 'euro' })).toEqual({ error: expect.stringMatching(/3-letter/) });
  });
});
