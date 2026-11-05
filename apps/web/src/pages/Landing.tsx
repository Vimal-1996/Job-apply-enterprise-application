import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Brand, Spinner } from '../components/ui';

const FEATURES = [
  { icon: '📋', title: 'One tracker for every application', text: 'Stages, deadlines and notes in one place.' },
  { icon: '✨', title: 'AI-tailored resumes and cover letters', text: 'Drafted for each job description, never invented.' },
  { icon: '✅', title: 'You approve every application', text: 'Agents draft; nothing is sent without your review.' },
];

export function Landing() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      await auth.signinRedirect();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <section className="landing-hero">
        <Brand />
        <h1>Your job search, organised and assisted.</h1>
        <p className="lead">
          Track applications, keep your resume sharp for every role, and let agents prepare drafts for you to review.
        </p>
        <ul className="features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="icon" aria-hidden>
                {f.icon}
              </span>
              <div>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-panel">
        <div className="signin-card">
          <h2>Welcome back</h2>
          <p>Sign in to continue to your dashboard.</p>
          {auth.error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              Sign-in failed: {auth.error.message}
            </p>
          )}
          <button className="btn btn-primary btn-lg" onClick={() => void signIn()} disabled={busy}>
            {busy ? <Spinner small /> : null}
            {busy ? 'Redirecting…' : 'Sign in'}
          </button>
          <div className="trust">
            <span>🔒 Encrypted</span>
            <span>🛡️ MFA required</span>
            <span>☁️ AWS Cognito</span>
          </div>
        </div>
      </section>
    </div>
  );
}
