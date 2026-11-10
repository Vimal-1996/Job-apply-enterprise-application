import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../../api/types';
import { acceptAllIds, counts, documentUrl, finalText, isWorkdayJob, scoreDelta, shouldAutoStart, suggestionLabel } from './tailorView';

const s = (over: Partial<Suggestion>): Suggestion => ({
  id: 'a',
  kind: 'add_skill',
  workIndex: null,
  bulletIndex: null,
  before: null,
  after: 'PostgreSQL',
  reason: '',
  source: 'resume',
  question: null,
  decision: 'pending',
  editedText: null,
  ...over,
});

describe('tailorView', () => {
  const roles = [{ title: 'Engineer', company: 'Globex' }];

  it('labels what each suggestion changes', () => {
    expect(suggestionLabel(s({ kind: 'summary' }), roles)).toBe('Summary');
    expect(suggestionLabel(s({ kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 0 }), roles)).toBe('Experience · Engineer, Globex · reworded bullet');
    expect(suggestionLabel(s({ kind: 'add_bullet', workIndex: 5 }), roles)).toBe('Experience · new bullet');
  });

  it("uses the user's edit when there is one", () => {
    expect(finalText(s({ editedText: 'Postgres (PostgreSQL)' }))).toBe('Postgres (PostgreSQL)');
    expect(finalText(s({}))).toBe('PostgreSQL');
  });

  it('recognises jobs that apply through Workday', () => {
    expect(isWorkdayJob({ url: null, details: { applyUrl: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/123' } })).toBe(true);
    expect(isWorkdayJob({ url: 'https://acme.myworkdaysite.com/recruiting/acme/x', applyUrl: null })).toBe(true);
    expect(isWorkdayJob({ url: 'https://www.linkedin.com/jobs/view/1', applyUrl: 'https://notmyworkdayjobs.com.evil.example/x' })).toBe(false);
    expect(isWorkdayJob({ url: 'not a url', applyUrl: null })).toBe(false);
  });

  it('accepts all only pending suggestions backed by the resume', () => {
    const list = [
      s({ id: '1' }),
      s({ id: '2', source: 'needs_confirmation', question: 'Used Kubernetes?' }),
      s({ id: '3', decision: 'rejected' }),
      s({ id: '4', decision: 'accepted' }),
    ];
    expect(acceptAllIds(list)).toEqual(['1']);
    expect(counts(list)).toEqual({ accepted: 1, rejected: 1, pending: 2 });
  });
});

describe('documentUrl', () => {
  it('adds only the options that differ from the defaults', () => {
    expect(documentUrl('/profile/document', { format: 'docx' })).toBe('/profile/document');
    expect(documentUrl('/profile/document', { format: 'pdf' })).toBe('/profile/document?format=pdf');
    expect(documentUrl('/jobs/1/resume-draft/document', { format: 'pdf', workday: true })).toBe('/jobs/1/resume-draft/document?format=pdf&layout=workday');
    expect(documentUrl('/jobs/1/resume-draft/document', { format: 'docx', workday: true })).toBe('/jobs/1/resume-draft/document?layout=workday');
  });
});

describe('shouldAutoStart', () => {
  const draft = { status: 'none' as const, aiEnabled: true };
  it('starts only for a matched job with no suggestions yet, when AI is set up', () => {
    expect(shouldAutoStart(draft, { details: {} })).toBe(true);
    expect(shouldAutoStart(draft, { details: null })).toBe(false);
    expect(shouldAutoStart({ ...draft, aiEnabled: false }, { details: {} })).toBe(false);
    expect(shouldAutoStart({ ...draft, status: 'ready' }, { details: {} })).toBe(false);
    expect(shouldAutoStart({ ...draft, status: 'failed' }, { details: {} })).toBe(false);
  });
});

describe('scoreDelta', () => {
  it('shows the change with a tone', () => {
    expect(scoreDelta(70, 82)).toEqual({ text: '+12', tone: 'success' });
    expect(scoreDelta(70, 70)).toEqual({ text: '±0', tone: 'neutral' });
    expect(scoreDelta(70, 65)).toEqual({ text: '−5', tone: 'danger' });
  });
});
