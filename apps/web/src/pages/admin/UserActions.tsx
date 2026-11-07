import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, apiDelete, apiPost } from '../../api/client';
import type { UserDetail } from '../../api/types';
import { Spinner } from '../../components/ui';
import { ACTION_COPY, availableActions, type UserAction } from './userActions';

/** Deactivate / reactivate / delete, each behind an inline confirmation. */
export function UserActions({ user, onChanged }: { user: UserDetail; onChanged: (u: UserDetail) => void }) {
  const auth = useAuth();
  const [pending, setPending] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const actions = availableActions(user);

  const run = async (action: UserAction) => {
    setBusy(true);
    setMessage(null);
    const path = `/admin/users/${encodeURIComponent(user.id)}`;
    const token = auth.user?.access_token;
    try {
      if (action === 'resend-invite') await apiPost(`${path}/resend-invite`, token);
      else
        onChanged(
          action === 'delete' ? await apiDelete<UserDetail>(path, token) : await apiPost<UserDetail>(`${path}/${action}`, token),
        );
      setMessage({ ok: true, text: ACTION_COPY[action].done });
      setPending(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Could not reach the API.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="drawer-section">
      <h4>Access</h4>
      {user.groups.includes('admin') ? (
        <p className="muted" style={{ margin: 0 }}>
          Administrators can't be deactivated or deleted here. Remove the admin role in Cognito first.
        </p>
      ) : user.accountStatus === 'deleted' ? (
        <p className="muted" style={{ margin: 0 }}>
          This account was deleted. Signing in shows them a contact-your-administrator message. Signing up again, or
          adding them again with Add user, replaces it with a fresh account.
        </p>
      ) : pending ? (
        <div className={`confirm ${ACTION_COPY[pending].danger ? 'danger' : ''}`} role="alertdialog" aria-label={ACTION_COPY[pending].label}>
          <strong>
            {pending === 'resend-invite' ? 'Resend invitation to' : ACTION_COPY[pending].label.replace(' user', '')}{' '}
            {user.email ?? user.id}?
          </strong>
          <p style={{ margin: 0 }}>{ACTION_COPY[pending].confirm}</p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={ACTION_COPY[pending].danger ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={() => void run(pending)}
              disabled={busy}
              autoFocus
            >
              {busy && <Spinner small />} {ACTION_COPY[pending].label}
            </button>
            <button className="btn btn-ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          {actions.map((a) => (
            <button
              key={a}
              className={ACTION_COPY[a].danger ? 'btn btn-danger-ghost' : 'btn btn-ghost'}
              onClick={() => {
                setMessage(null);
                setPending(a);
              }}
            >
              {ACTION_COPY[a].label}
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" style={{ margin: 0, color: message.ok ? 'var(--success)' : 'var(--danger)' }}>
          {message.text}
        </p>
      )}
    </section>
  );
}
