import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { Resume } from '../api/types';
import { ApiCheck } from '../components/ApiCheck';

const STATS = [
  { label: 'Applications tracked', value: '0' },
  { label: 'Drafts awaiting review', value: '0' },
  { label: 'Agent runs this week', value: '0' },
];

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
  const STEPS = [
    { label: 'Create your account', done: true },
    { label: 'Upload your resume', done: hasResume === true, to: '/resume' },
    { label: 'Connect a job source', done: false },
    { label: 'Schedule your first agent run', done: false },
  ];

  return (
    <>
      <header className="page-head">
        <h1>Welcome, {name}</h1>
        <p>Here's where your job search stands.</p>
      </header>

      <div className="grid">
        {STATS.map((s) => (
          <div key={s.label} className="card stat">
            <div className="value">{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
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
