import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { groupsFromProfile, requiresMfa } from '../auth/roles';
import { ApiCheck } from '../components/ApiCheck';
import { Badge } from '../components/ui';

function useCountdown(expiresAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!expiresAt) return '—';
  const s = Math.max(0, Math.round(expiresAt - now / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function Account() {
  const auth = useAuth();
  const p = auth.user?.profile;
  const groups = groupsFromProfile(p);
  const remaining = useCountdown(auth.user?.expires_at);

  return (
    <>
      <header className="page-head">
        <h1>Account & security</h1>
        <p>Your identity, roles and current session.</p>
      </header>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card">
          <h3>Profile</h3>
          <dl className="kv">
            <dt>Email</dt>
            <dd>
              {p?.email}{' '}
              {p?.email_verified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}
            </dd>
            <dt>User ID</dt>
            <dd>
              <code>{p?.sub}</code>
            </dd>
            <dt>Roles</dt>
            <dd className="row" style={{ gap: 6 }}>
              {groups.length ? groups.map((g) => <Badge key={g} tone="primary">{g}</Badge>) : <Badge>none</Badge>}
            </dd>
          </dl>
        </div>

        <div className="card">
          <h3>Session</h3>
          <dl className="kv">
            <dt>Sign-in method</dt>
            <dd>Cognito · password{requiresMfa(groups) ? ' + authenticator app' : ''}</dd>
            <dt>MFA</dt>
            <dd>
              {requiresMfa(groups) ? (
                <Badge tone="success" dot>
                  Required for administrators
                </Badge>
              ) : (
                <Badge>Not required</Badge>
              )}
            </dd>
            <dt>Token refresh in</dt>
            <dd>{remaining} (renews automatically)</dd>
          </dl>
        </div>
      </div>

      <ApiCheck title="Identity as seen by the API" path="/me" description="What the backend reads from your token." />
    </>
  );
}
