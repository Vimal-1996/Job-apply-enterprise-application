import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { JobSummary, Resume } from '../api/types';
import { ApiCheck } from '../components/ApiCheck';
import { pipelineCounts } from './jobs/applicationView';

/** The user's jobs (null while loading or if the API is unreachable). */
function useJobs(token: string | undefined): JobSummary[] | null {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<JobSummary[]>('/jobs', token)
      .then((j) => !cancelled && setJobs(j))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);
  return jobs;
}

/** Whether the user has a resume yet (null while loading or if the API is unreachable). */
function useHasResume(token: string | undefined): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<Resume[]>('/resumes', token)
      .then((r) => !cancelled && setHas(r.length > 0))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);
  return has;
}

export function Dashboard() {
  const auth = useAuth();
  const name = auth.user?.profile.email?.split('@')[0] ?? 'there';
  const hasResume = useHasResume(auth.user?.access_token);
  const jobs = useJobs(auth.user?.access_token);
  const c = jobs ? pipelineCounts(jobs) : null;
  const show = (n: number | undefined) => (n === undefined ? '–' : String(n));
  const STATS = [
    { label: 'Jobs saved', value: show(jobs?.length), to: '/jobs' },
    { label: 'Applied', value: show(c?.applied), to: '/applications' },
    { label: 'Interviewing', value: show(c?.interviewing), to: '/applications' },
  ];
  const STEPS = [
    { label: 'Create your account', done: true },
    { label: 'Upload your resume', done: hasResume === true, to: '/profile' },
    { label: 'Add a job and see your match', done: (jobs?.length ?? 0) > 0, to: '/jobs' },
    { label: 'Mark a job as applied', done: (c?.applied ?? 0) > 0, to: '/applications' },
  ];

  return (
    <>
      <header className="page-head">
        <h1>Welcome, {name}</h1>
        <p>Here's where your job search stands.</p>
      </header>

      <div className="grid">
        {STATS.map((s) => (
          <Link key={s.label} to={s.to} className="card stat stat-link">
            <div className="value">{s.value}</div>
            <div className="label">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card">
          <h3>Getting started</h3>
          <ul className="checklist">
            {STEPS.map((s) => (
              <li key={s.label}>
                <span className={s.done ? 'check done' : 'check'}>✓</span>
                {s.to && !s.done ? <Link to={s.to}>{s.label}</Link> : <span className={s.done ? '' : 'muted'}>{s.label}</span>}
              </li>
            ))}
          </ul>
        </div>
        <ApiCheck title="Backend connection" path="/me" description="Verifies your session with the API." />
      </div>
    </>
  );
}
