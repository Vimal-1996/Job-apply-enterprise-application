import { useAuth } from 'react-oidc-context';
import { ApiCheck } from '../components/ApiCheck';

const STATS = [
  { label: 'Applications tracked', value: '0' },
  { label: 'Drafts awaiting review', value: '0' },
  { label: 'Agent runs this week', value: '0' },
];

const STEPS = [
  { label: 'Sign in with MFA', done: true },
  { label: 'Upload your resume', done: false },
  { label: 'Connect a job source', done: false },
  { label: 'Schedule your first agent run', done: false },
];

export function Dashboard() {
  const auth = useAuth();
  const name = auth.user?.profile.email?.split('@')[0] ?? 'there';

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
                <span className={s.done ? '' : 'muted'}>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <ApiCheck title="Backend connection" path="/me" description="Verifies your session with the API." />
      </div>
    </>
  );
}
