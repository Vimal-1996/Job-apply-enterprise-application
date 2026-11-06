import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { ADMIN_NAV } from './adminNav';
import { useUserStats } from './userStats';

/** Admin console landing page: headline numbers and shortcuts to each section. */
export function Overview() {
  const { stats, error } = useUserStats();

  const cards = [
    { label: 'Total accounts', value: stats && `${stats.total}${stats.more ? '+' : ''}` },
    { label: 'Admins', value: stats?.admins },
    { label: 'Users', value: stats?.users },
    { label: 'Pending invitations', value: stats?.pending },
  ];
  const sections = ADMIN_NAV.flatMap((g) => g.items).filter((i) => i.to !== '/admin');

  return (
    <>
      <header className="page-head">
        <h1>Overview</h1>
        <p>A summary of the platform. Visible to administrators only.</p>
      </header>

      {error ? (
        <div className="banner">⚠️ Could not load account numbers. Check that the API is running.</div>
      ) : (
        <div className="grid">
          {cards.map((s) => (
            <div key={s.label} className="card stat">
              <div className="value">{stats ? s.value : <Spinner small />}</div>
              <div className="label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Sections</h3>
        <div className="section-grid">
          {sections.map((s) =>
            s.soon ? (
              <div key={s.to} className="section-tile disabled">
                <span className="admin-icon" aria-hidden>
                  {s.icon}
                </span>
                <div>
                  <strong>
                    {s.label} <span className="soon">soon</span>
                  </strong>
                  <span className="muted">{s.description}</span>
                </div>
              </div>
            ) : (
              <Link key={s.to} to={s.to} className="section-tile">
                <span className="admin-icon" aria-hidden>
                  {s.icon}
                </span>
                <div>
                  <strong>{s.label}</strong>
                  <span className="muted">{s.description}</span>
                </div>
              </Link>
            ),
          )}
        </div>
      </div>
    </>
  );
}
