import { lazy, Suspense } from 'react';
import { useAuth } from 'react-oidc-context';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { AccountGate } from './auth/AccountGate';
import { RequireAuth } from './auth/RequireAuth';
import { useSigningOut } from './auth/useSigningOut';
import { groupsFromProfile } from './auth/roles';
import { Brand, FullPage, Spinner } from './components/ui';
import { UserMenu } from './components/UserMenu';
import { Account } from './pages/Account';
import { Callback } from './pages/Callback';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';
import { JobDetailPage } from './pages/jobs/JobDetailPage';
import { JobsPage } from './pages/jobs/JobsPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { ResumePage } from './pages/resume/ResumePage';

// The admin console is a separate bundle: normal users never download its code.
const admin = () => import('./pages/admin');
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => admin().then((m) => ({ default: m.Overview })));
const AdminUsers = lazy(() => admin().then((m) => ({ default: m.Users })));
const AdminDashboard = lazy(() => admin().then((m) => ({ default: m.AdminDashboard })));

/** Admins manage the platform; job seekers manage their search. */
function DashboardForRole() {
  const auth = useAuth();
  return groupsFromProfile(auth.user?.profile).includes('admin') ? <AdminDashboard /> : <Dashboard />;
}

function Shell() {
  const auth = useAuth();
  const groups = groupsFromProfile(auth.user?.profile);
  const isAdmin = groups.includes('admin');
  const isJobSeeker = groups.includes('user');

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
          {isJobSeeker && <NavLink to="/resume">Resume</NavLink>}
          {isJobSeeker && <NavLink to="/profile">Profile</NavLink>}
          {isJobSeeker && <NavLink to="/jobs">Jobs</NavLink>}
          {isJobSeeker && (
            <a aria-disabled title="Coming soon">
              <span className="label-long">Applications</span> <span className="soon">soon</span>
            </a>
          )}
          {isAdmin && (
            <NavLink to="/admin">
              Admin <span className="soon admin-tag">admin</span>
            </NavLink>
          )}
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
        <Suspense
          fallback={
            <div className="center" style={{ minHeight: 240 }}>
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** Signed out → landing page; signed in → dashboard inside the app shell. */
function Home() {
  const auth = useAuth();
  const signingOut = useSigningOut();
  if (auth.isLoading || signingOut) {
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
    <AccountGate>
      <Routes>
      <Route path="/callback" element={<Callback />} />
      <Route element={<Home />}>
        <Route index element={<DashboardForRole />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/account" element={<Account />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
      </Route>
      {/* Admin-only. Non-admins get a 404, not a 403, so these pages stay invisible. */}
      <Route
        element={
          <RequireAuth roles={['admin']} hidden>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
      </Routes>
    </AccountGate>
  );
}
