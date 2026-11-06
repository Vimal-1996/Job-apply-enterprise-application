import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { UserPage } from '../../api/types';
import { Spinner } from '../../components/ui';
import { ADMIN_NAV } from './adminNav';

interface Counts {
  total: string;
  admins: number;
  users: number;
  pending: number;
}

/** Admin landing page: headline numbers and shortcuts to each section. */
export function Overview() {
  const auth = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<UserPage>('/admin/users?filter=all', auth.user?.access_token)
      .then(({ users, nextToken }) =>
        setCounts({
          total: `${users.length}${nextToken ? '+' : ''}`,
          admins: users.filter((u) => u.groups.includes('admin')).length,
          users: users.filter((u) => u.groups.includes('user')).length,
          pending: users.filter((u) => u.status === 'FORCE_CHANGE_PASSWORD').length,
        }),
      )
      .catch(() => setError(true));
  }, [auth.user?.access_token]);

  const stats = [
    { label: 'Total accounts', value: counts?.total },
    { label: 'Admins', value: counts?.admins },
    { label: 'Users', value: counts?.users },
    { label: 'Pending invitations', value: counts?.pending },
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
          {stats.map((s) => (
            <div key={s.label} className="card stat">
              <div className="value">{counts ? s.value : <Spinner small />}</div>
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
