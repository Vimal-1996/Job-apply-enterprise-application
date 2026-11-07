import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { apiGet } from '../../api/client';
import type { UserPage, UserSummary } from '../../api/types';
import { Badge, initials, Spinner } from '../../components/ui';
import { accountStatus, formatDate } from './format';
import { AddUserDialog } from './AddUserDialog';
import { UserDrawer } from './UserDrawer';

type Filter = 'all' | 'user' | 'admin';
const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'user', label: 'Users' },
  { key: 'admin', label: 'Admins' },
];

/** Admin-only directory of every account in the user pool. */
export function Users() {
  const auth = useAuth();
  const token = auth.user?.access_token;
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // The server searches every user (email prefix); wait for typing to pause.
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const fetchPage = useCallback(
    (f: Filter, q: string, cursor?: string) => {
      const qs = new URLSearchParams({ filter: f });
      if (q) qs.set('q', q);
      if (cursor) qs.set('nextToken', cursor);
      return apiGet<UserPage>(`/admin/users?${qs}`, token);
    },
    [token],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(filter, query);
      setUsers(page.users);
      setNextToken(page.nextToken);
    } catch {
      setError('Could not load users. Check that the API is running and you are still signed in.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage, filter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextToken) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(filter, query, nextToken);
      setUsers((prev) => [...prev, ...page.users]);
      setNextToken(page.nextToken);
    } catch {
      setError('Could not load more users.');
    } finally {
      setLoadingMore(false);
    }
  };

  const visible = users;

  return (
    <>
      <header className="page-head row">
        <div>
          <h1>Users</h1>
          <p>Every account in the user pool. Only administrators can see this page.</p>
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            ↻ Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add user
          </button>
        </div>
      </header>

      <div className="card" style={{ padding: 0, gap: 0 }}>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter by role">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={filter === t.key}
                className={filter === t.key ? 'tab active' : 'tab'}
                onClick={() => setFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <input
            className="search"
            type="search"
            placeholder="Search by email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>

        {loading ? (
          <div className="table-state">
            <Spinner />
          </div>
        ) : error ? (
          <div className="table-state" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="table-state muted">
            {search ? `No users match “${search}”.` : filter === 'all' ? 'No users yet.' : `No ${filter === 'admin' ? 'admins' : 'users'} yet.`}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const status = accountStatus(u);
                  return (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      onClick={() => setSelected(u.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected(u.id))}
                      aria-label={`View ${u.email ?? u.id}`}
                    >
                      <td>
                        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                          <span className="avatar">{initials(u.email ?? undefined)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-main">{u.email ?? '—'}</div>
                            <div className="cell-sub">
                              <code>{u.id.slice(0, 8)}…</code>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {u.groups.length ? (
                          u.groups.map((g) => (
                            <Badge key={g} tone={g === 'admin' ? 'primary' : 'neutral'}>
                              {g}
                            </Badge>
                          ))
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={status.tone} dot>
                          {status.label}
                        </Badge>
                      </td>
                      <td>{u.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}</td>
                      <td className="muted">{formatDate(u.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && (
          <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
            <span className="muted">
              {visible.length} {visible.length === 1 ? 'account' : 'accounts'}
              {search && ` matching “${search}”`}
            </span>
            <span className="spacer" />
            {nextToken && (
              <button className="btn btn-ghost" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Spinner small /> : null} Load more
              </button>
            )}
          </div>
        )}
      </div>

      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={({ mfaMethods, preferredMfa, identityProvider, ...summary }) =>
            setUsers((prev) => [...prev.filter((u) => u.id !== summary.id), summary].sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '')))
          }
        />
      )}

      {selected && (
        <UserDrawer
          userId={selected}
          onClose={() => setSelected(null)}
          onChanged={(changed) =>
            setUsers((prev) => prev.map((u) => (u.id === changed.id ? { ...u, accountStatus: changed.accountStatus } : u)))
          }
        />
      )}
    </>
  );
}
