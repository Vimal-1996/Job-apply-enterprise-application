import { describe, expect, it } from 'vitest';
import { DESCRIPTION_MIN, jobTitle, newJobRequest, safeUrl, sortJobs, verdictLabel } from './jobView';

const long = 'x'.repeat(DESCRIPTION_MIN);

describe('newJobRequest', () => {
  it('needs a description', () => {
    expect(newJobRequest('https://x', '   ')).toEqual({ error: 'Paste the job description.' });
  });
  it('rejects a description too short to judge', () => {
    expect(newJobRequest('', 'Senior engineer')).toHaveProperty('error');
  });
  it('trims, and leaves out an empty link', () => {
    expect(newJobRequest('  ', `  ${long}  `)).toEqual({ body: { description: long } });
    expect(newJobRequest(' https://www.linkedin.com/jobs/view/1 ', long)).toEqual({
      body: { link: 'https://www.linkedin.com/jobs/view/1', description: long },
    });
  });
});

describe('sortJobs', () => {
  it('puts matching first, then by score, failed last', () => {
    const jobs = [
      { id: 'a', matchStatus: 'ready' as const, score: 50, createdAt: '2026-11-01' },
      { id: 'b', matchStatus: 'failed' as const, score: null, createdAt: '2026-11-03' },
      { id: 'c', matchStatus: 'ready' as const, score: 90, createdAt: '2026-11-02' },
      { id: 'd', matchStatus: 'matching' as const, score: null, createdAt: '2026-11-01' },
    ];
    expect(sortJobs(jobs).map((j) => j.id)).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('labels', () => {
  it('names jobs before they are read', () => {
    expect(jobTitle({ title: null, company: null, matchStatus: 'matching' })).toBe('Reading the job…');
    expect(jobTitle({ title: 'Dev', company: null, matchStatus: 'ready' })).toBe('Dev');
  });
  it('maps verdicts to tones', () => {
    expect(verdictLabel('strong').tone).toBe('success');
    expect(verdictLabel('weak').tone).toBe('danger');
  });
  it('only allows http(s) links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://a.b')).toBe('https://a.b');
  });
});
