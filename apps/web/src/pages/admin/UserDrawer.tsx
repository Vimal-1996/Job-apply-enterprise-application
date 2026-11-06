import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, apiGet } from '../../api/client';
import type { UserDetail } from '../../api/types';
import { UserActions } from './UserActions';
import { Badge, initials, Spinner } from '../../components/ui';
import { accountStatus, formatDateTime } from './format';

/** Side panel with one user's full account details. */
export function UserDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  /** Called after an admin action so the list can update the row. */
  onChanged?: (user: UserDetail) => void;
}) {
  const auth = useAuth();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setUser(null);
    setError(null);
    apiGet<UserDetail>(`/admin/users/${encodeURIComponent(userId)}`, auth.user?.access_token)
      .then((u) => !cancelled && setUser(u))
      .catch((e) => !cancelled && setError(e instanceof ApiError && e.status === 404 ? 'User not found.' : 'Could not load this user.'));
    return () => {
      cancelled = true;
    };
  }, [userId, auth.user?.access_token]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = user ? accountStatus(user) : null;

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="User details">
        <div className="row">
          <h3>User details</h3>
          <span className="spacer" />
          <button ref={closeRef} className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!user && !error && (
          <div className="center" style={{ minHeight: 200 }}>
            <Spinner />
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {user && status && (
          <>
            <div className="row" style={{ gap: 14 }}>
              <span className="avatar avatar-lg">{initials(user.email ?? undefined)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{user.email ?? 'No email'}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                  {user.groups.map((g) => (
                    <Badge key={g} tone="primary">
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <section className="drawer-section">
              <h4>Account</h4>
              <dl className="kv">
                <dt>User ID</dt>
                <dd>
                  <code>{user.id}</code>
                </dd>
                <dt>Email</dt>
                <dd>
                  {user.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}
                </dd>
                <dt>Sign-in via</dt>
                <dd>{user.identityProvider}</dd>
                <dt>Roles</dt>
                <dd>{user.groups.length ? user.groups.join(', ') : 'none'}</dd>
              </dl>
            </section>

            <section className="drawer-section">
              <h4>Security</h4>
              <dl className="kv">
                <dt>MFA</dt>
                <dd>
                  <Badge tone="success" dot>
                    Enforced by pool policy
                  </Badge>
                </dd>
                <dt>Preferred method</dt>
                <dd>{user.preferredMfa === 'SOFTWARE_TOKEN_MFA' ? 'Authenticator app' : (user.preferredMfa ?? 'Not set')}</dd>
              </dl>
            </section>

            <section className="drawer-section">
              <h4>Activity</h4>
              <dl className="kv">
                <dt>Created</dt>
                <dd>{formatDateTime(user.createdAt)}</dd>
                <dt>Last updated</dt>
                <dd>{formatDateTime(user.updatedAt)}</dd>
              </dl>
            </section>

            <UserActions
              user={user}
              onChanged={(u) => {
                setUser(u);
                onChanged?.(u);
              }}
            />
          </>
        )}
      </aside>
    </div>
  );
}
