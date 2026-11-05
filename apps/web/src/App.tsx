import { useAuth } from 'react-oidc-context';
import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { groupsFromProfile } from './auth/roles';
import { Brand, FullPage, Spinner } from './components/ui';
import { UserMenu } from './components/UserMenu';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';
import { Callback } from './pages/Callback';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';

function Shell() {
  const auth = useAuth();
  const isAdmin = groupsFromProfile(auth.user?.profile).includes('admin');

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" aria-label="Home">
          <Brand />
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <a aria-disabled title="Coming soon">
            <span className="label-long">Applications</span> <span className="soon">soon</span>
          </a>
          <NavLink to="/account">Account</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <span className="spacer" />
        <UserMenu />
      </header>
      {auth.error && (
        <div className="content" style={{ paddingBottom: 0 }}>
          <div className="banner">⚠️ Your session could not be refreshed. Please sign in again.</div>
        </div>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

/** Signed out → landing page; signed in → dashboard inside the app shell. */
function Home() {
  const auth = useAuth();
  if (auth.isLoading) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  return auth.isAuthenticated ? <Shell /> : <Landing />;
}

export function App() {
  return (
    <Routes>
      <Route path="/callback" element={<Callback />} />
      <Route element={<Home />}>
        <Route index element={<Dashboard />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/account" element={<Account />} />
      </Route>
      <Route
        element={
          <RequireAuth roles={['admin']}>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
