import { describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '../../api/types';
import { groupByStatus, pipelineCounts, statusInfo } from './applicationView';

const job = (id: string, applicationStatus: ApplicationStatus, statusChangedAt: string | null, createdAt = '2026-11-01') => ({
  id,
  applicationStatus,
  statusChangedAt,
  createdAt,
});

describe('applicationView', () => {
  const jobs = [
    job('a', 'applied', '2026-11-03'),
    job('b', 'applied', '2026-11-05'),
    job('c', 'saved', null, '2026-11-04'),
    job('d', 'interviewing', '2026-11-06'),
    job('e', 'rejected', '2026-11-07'),
  ];

  it('groups jobs in pipeline order, latest move first', () => {
    const groups = groupByStatus(jobs);
    expect(groups.map((g) => g.value)).toEqual(['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn']);
    expect(groups[1].jobs.map((j) => j.id)).toEqual(['b', 'a']);
    expect(groups[3].jobs).toEqual([]);
  });

  it('counts the pipeline', () => {
    expect(pipelineCounts(jobs)).toEqual({ saved: 1, applied: 4, active: 3, interviewing: 1, offers: 0 });
  });

  it('labels statuses', () => {
    expect(statusInfo('interviewing').label).toBe('Interviewing');
    expect(statusInfo('rejected').closed).toBe(true);
  });
});
