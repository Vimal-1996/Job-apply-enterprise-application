import { useAuth } from 'react-oidc-context';
import { Link, Route, Routes } from 'react-router-dom';
import { cognitoLogoutUrl } from './auth/oidc';
import { RequireAuth } from './auth/RequireAuth';
import { groupsFromProfile } from './auth/roles';
import { ApiProbe } from './pages/ApiProbe';

function Nav() {
  const auth = useAuth();
  const groups = groupsFromProfile(auth.user?.profile);

  const signOut = async () => {
    await auth.removeUser(); // clear local tokens
    window.location.href = cognitoLogoutUrl(); // end the Cognito session too
  };

  return (
    <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Link to="/">Home</Link>
      <Link to="/me">My account</Link>
      {groups.includes('admin') && <Link to="/admin">Admin</Link>}
      <span style={{ marginLeft: 'auto' }}>
        {auth.isAuthenticated ? (
          <>
            {auth.user?.profile.email} [{groups.join(', ') || 'no role'}]{' '}
            <button onClick={signOut}>Sign out</button>
          </>
        ) : (
          <button onClick={() => auth.signinRedirect()}>Sign in</button>
        )}
      </span>
    </nav>
  );
}

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <Nav />
      <Routes>
        <Route path="/" element={<h1>Job Apply</h1>} />
        <Route
          path="/me"
          element={
            <RequireAuth>
              <ApiProbe title="My account" path="/me" />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth roles={['admin']}>
              <ApiProbe title="Admin" path="/admin/ping" />
            </RequireAuth>
          }
        />
        <Route path="/callback" element={<p>Signing in…</p>} />
        <Route path="*" element={<p>Not found</p>} />
      </Routes>
    </main>
  );
}
