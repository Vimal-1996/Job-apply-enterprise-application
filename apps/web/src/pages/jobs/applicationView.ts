import type { ApplicationStatus, JobSummary } from '../../api/types';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** In pipeline order: active stages first, then closed ones. */
export const STATUSES: { value: ApplicationStatus; label: string; tone: Tone; closed?: boolean }[] = [
  { value: 'saved', label: 'Saved', tone: 'neutral' },
  { value: 'applied', label: 'Applied', tone: 'primary' },
  { value: 'interviewing', label: 'Interviewing', tone: 'warning' },
  { value: 'offer', label: 'Offer', tone: 'success' },
  { value: 'rejected', label: 'Rejected', tone: 'danger', closed: true },
  { value: 'withdrawn', label: 'Withdrawn', tone: 'neutral', closed: true },
];

export const statusInfo = (s: ApplicationStatus) => STATUSES.find((x) => x.value === s)!;

/** Jobs grouped by status in pipeline order; most recently moved first within a stage. */
export function groupByStatus<T extends Pick<JobSummary, 'applicationStatus' | 'statusChangedAt' | 'createdAt'>>(jobs: T[]) {
  const latest = (j: T) => j.statusChangedAt ?? j.createdAt;
  return STATUSES.map((s) => ({
    ...s,
    jobs: jobs.filter((j) => j.applicationStatus === s.value).sort((a, b) => latest(b).localeCompare(latest(a))),
  }));
}

/**
 * The jobs with one moved to another stage, as shown straight away while the
 * change saves. Unchanged (same array) if the job isn't there or is already in that stage.
 */
export function moveJob<T extends Pick<JobSummary, 'id' | 'applicationStatus' | 'statusChangedAt'>>(
  jobs: T[],
  id: string,
  status: ApplicationStatus,
  now: string,
): T[] {
  const job = jobs.find((j) => j.id === id);
  if (!job || job.applicationStatus === status) return jobs;
  return jobs.map((j) => (j.id === id ? { ...j, applicationStatus: status, statusChangedAt: now } : j));
}

/** Headline numbers: everything past "saved" counts as applied. */
export function pipelineCounts(jobs: Pick<JobSummary, 'applicationStatus'>[]) {
  const n = (s: ApplicationStatus) => jobs.filter((j) => j.applicationStatus === s).length;
  return {
    saved: n('saved'),
    applied: jobs.length - n('saved'),
    active: n('applied') + n('interviewing') + n('offer'),
    interviewing: n('interviewing'),
    offers: n('offer'),
  };
}
