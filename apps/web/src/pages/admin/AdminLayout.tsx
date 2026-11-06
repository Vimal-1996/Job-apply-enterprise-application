import { NavLink, Outlet } from 'react-router-dom';
import { ADMIN_NAV } from './adminNav';

/** Admin console frame: section sidebar on the left, page on the right. */
export function AdminLayout() {
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
