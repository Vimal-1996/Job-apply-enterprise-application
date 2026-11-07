import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, apiPost } from '../../api/client';
import type { UserDetail } from '../../api/types';
import { Spinner } from '../../components/ui';
import { looksLikeEmail } from './format';

/** Invites a new user: Cognito creates the account and emails a temporary password. */
export function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: UserDetail) => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<UserDetail | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await apiPost<UserDetail>('/admin/users', auth.user?.access_token, { email: email.trim() });
      setCreated(u);
      onCreated(u);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <h3 id="add-user-title">Add user</h3>
        {created ? (
          <>
            <p role="status" style={{ margin: 0 }}>
              ✅ <strong>{created.email}</strong> has been added. They'll receive an email with a temporary password,
              valid for 3 days. On first sign-in they choose a new password.
            </p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCreated(null);
                  setEmail('');
                  setTimeout(() => inputRef.current?.focus());
                }}
              >
                Add another
              </button>
              <button className="btn btn-primary" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 14 }} noValidate>
            <p className="muted" style={{ margin: 0 }}>
              The new account gets the <strong>user</strong> role. We'll email them a temporary password.
            </p>
            <label className="field">
              <span>Email address</span>
              <input
                ref={inputRef}
                className="search"
                style={{ width: '100%' }}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'add-user-error' : undefined}
                disabled={busy}
                maxLength={254}
              />
            </label>
            {error && (
              <p id="add-user-error" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
                {error}
              </p>
            )}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                {busy && <Spinner small />} Add user & send invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
