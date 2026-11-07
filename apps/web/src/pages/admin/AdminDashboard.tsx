import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { ApiCheck } from '../../components/ApiCheck';
import { Badge, initials, Spinner } from '../../components/ui';
import { accountStatus, formatDate } from './format';
import { newest, useUserStats } from './userStats';

/** Home page for administrators: people, integrations and platform health. */
export function AdminDashboard() {
  const auth = useAuth();
  const name = auth.user?.profile.email?.split('@')[0] ?? 'there';
  const { users, stats, error } = useUserStats();
  const recent = newest(users, 5);

  const cards = [
    { label: 'Total users', value: stats && `${stats.total}${stats.more ? '+' : ''}`, to: '/admin/users' },
    { label: 'Active', value: stats?.active, to: '/admin/users' },
    { label: 'Pending invitations', value: stats?.pending, to: '/admin/users' },
    { label: 'Job portals connected', value: 0, to: undefined },
  ];

  const tasks = [
    { label: 'Create the first administrator', done: true },
    { label: 'Invite the first user', done: (stats?.users ?? 0) > 0 },
    { label: 'Connect a job portal', done: false },
    { label: 'Enable Google sign-in', done: false },
  ];

  return (
    <>
      <header className="page-head row">
        <div>
          <h1>Welcome, {name}</h1>
          <p>Here's how the platform and its users are doing.</p>
        </div>
        <span className="spacer" />
        <Link className="btn btn-primary" to="/admin/users">
          👥 Manage users
        </Link>
      </header>

      {error && <div className="banner">⚠️ Could not load user numbers. Check that the API is running.</div>}

      <div className="grid">
        {cards.map((c) => {
          const body = (
            <>
              <div className="value">{stats || c.to === undefined ? c.value : <Spinner small />}</div>
              <div className="label">{c.label}</div>
            </>
          );
          return c.to ? (
            <Link key={c.label} to={c.to} className="card stat stat-link">
              {body}
            </Link>
          ) : (
            <div key={c.label} className="card stat">
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card">
          <div className="row">
            <h3>Recent accounts</h3>
            <span className="spacer" />
            <Link to="/admin/users">View all →</Link>
          </div>
          {!stats && !error ? (
            <Spinner small />
          ) : recent.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No accounts yet.
            </p>
          ) : (
            <ul className="mini-list">
              {recent.map((u) => {
                const s = accountStatus(u);
                return (
                  <li key={u.id}>
                    <span className="avatar">{initials(u.email ?? undefined)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="cell-main">{u.email ?? u.id}</div>
                      <div className="cell-sub">
                        {u.groups.join(', ') || 'no role'} · joined {formatDate(u.createdAt)}
                      </div>
                    </div>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="row">
            <h3>Job portal connectors</h3>
            <span className="spacer" />
            <Badge>0 connected</Badge>
          </div>
          <div className="empty">
            <span className="empty-icon" aria-hidden>
              🔌
            </span>
            <strong>No job portals connected yet</strong>
            <span className="muted">
              Connectors bring job postings into the app so users' agents can draft applications for them.
            </span>
            <button className="btn btn-ghost" disabled title="Coming soon">
              + Add connector <span className="soon">soon</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card">
          <h3>Setup tasks</h3>
          <ul className="checklist">
            {tasks.map((t) => (
              <li key={t.label}>
                <span className={t.done ? 'check done' : 'check'}>✓</span>
                <span className={t.done ? '' : 'muted'}>{t.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <ApiCheck title="Platform health" path="/health" description="Checks that the backend API is up." />
      </div>
    </>
  );
}
