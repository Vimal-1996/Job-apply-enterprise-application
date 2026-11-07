import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { NavLink, Outlet } from 'react-router-dom';
import { ApiError, apiGet } from '../../api/client';
import { FullPage } from '../../components/ui';
import { ADMIN_NAV } from './adminNav';

/**
 * The API refuses admin routes to an admin account without MFA. Ask once on
 * entry so the console explains that instead of failing page by page.
 */
function useMfaBlocked(): { blocked: boolean; message: string } {
  const auth = useAuth();
  const [state, setState] = useState({ blocked: false, message: '' });
  useEffect(() => {
    let cancelled = false;
    apiGet('/admin/ping', auth.user?.access_token)
      .then(() => !cancelled && setState({ blocked: false, message: '' }))
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.code === 'MFA_REQUIRED') setState({ blocked: true, message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.access_token]);
  return state;
}

/** Admin console frame: section sidebar on the left, page on the right. */
export function AdminLayout() {
  const mfa = useMfaBlocked();
  if (mfa.blocked) {
    return (
      <FullPage>
        <div className="big-code" aria-hidden>
          🛡️
        </div>
        <h2>Multi-factor authentication required</h2>
        <p className="muted" role="alert" style={{ maxWidth: 460 }}>
          {mfa.message}
        </p>
      </FullPage>
    );
  }
  return (
    <div className="admin">
      <aside className="admin-sidebar" aria-label="Admin sections">
        <div className="admin-sidebar-head">
          <span className="badge primary">Admin console</span>
        </div>
        {ADMIN_NAV.map((group) => (
          <div key={group.title} className="admin-group">
            <div className="admin-group-title">{group.title}</div>
            {group.items.map((item) =>
              item.soon ? (
                <span key={item.to} className="admin-link disabled" aria-disabled title={`${item.description} (coming soon)`}>
                  <span className="admin-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="admin-label">{item.label}</span>
                  <span className="soon">soon</span>
                </span>
              ) : (
                <NavLink key={item.to} to={item.to} end className="admin-link" title={item.description}>
                  <span className="admin-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="admin-label">{item.label}</span>
                </NavLink>
              ),
            )}
          </div>
        ))}
      </aside>
      <section className="admin-main">
        <Outlet />
      </section>
    </div>
  );
}
