import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiPost } from '../api/client';
import { looksLikeEmail } from '../lib/email';
import { Spinner } from './ui';

/** Self sign-up: the API creates the account and Cognito emails a temporary password. */
export function SignupForm({ onSignIn }: { onSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ message: string }>('/signup', undefined, { email: email.trim() });
      setDone(res.message);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status !== 500 ? err.message : 'Something went wrong. Please try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <h2>Check your email</h2>
        <p role="status">{done}</p>
        <p className="muted" style={{ margin: 0 }}>
          The temporary password is valid for 3 days. On first sign-in you'll choose a new password.
        </p>
        <button className="btn btn-primary btn-lg" onClick={onSignIn}>
          Sign in
        </button>
      </>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 14 }} noValidate>
      <h2>Create your account</h2>
      <p style={{ margin: 0 }}>Enter your email and we'll send you a temporary password to sign in with.</p>
      <label className="field">
        <span>Email address</span>
        <input
          ref={inputRef}
          className="search"
          style={{ width: '100%' }}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'signup-error' : undefined}
          disabled={busy}
          maxLength={254}
        />
      </label>
      {error && (
        <p id="signup-error" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !email.trim()}>
        {busy && <Spinner small />} {busy ? 'Sending…' : 'Sign up'}
      </button>
    </form>
  );
}
