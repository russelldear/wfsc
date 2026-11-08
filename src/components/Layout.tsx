import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';

const envLabel = import.meta.env.VITE_ENV_LABEL as string | undefined;

export function Layout() {
  const { session, signOut, hasRole } = useAuth();
  const committee = hasRole('committee');
  return (
    <>
      {envLabel && <div className="env-banner">{envLabel}: test data only</div>}
      <header className="site-header">
        <div className="site-header-inner">
          <span className="brand">WFSC Members</span>
          <nav aria-label="Main">
            {committee && (
              <>
                <NavLink to="/" end>Members</NavLink>
                <NavLink to="/people/new">Add member</NavLink>
              </>
            )}
            {(committee || hasRole('coach')) && (
              <>
                <NavLink to="/skate-school">Skate school</NavLink>
                <NavLink to="/badges">Badges</NavLink>
              </>
            )}
            {committee && (
              <>
                <NavLink to="/settings/member-types">Member types</NavLink>
                <NavLink to="/import">Import</NavLink>
              </>
            )}
            {hasRole('admin') && <NavLink to="/access">Access</NavLink>}
          </nav>
          <span className="user">
            <span className="user-email">{session?.user.email}</span>
            <button type="button" className="link-button" onClick={() => void signOut()}>
              Sign out
            </button>
          </span>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}

export function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <>
      {envLabel && <div className="env-banner">{envLabel}: test data only</div>}
      <main className="centered">
        <div className="card">{children}</div>
      </main>
    </>
  );
}
