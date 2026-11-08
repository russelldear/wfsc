import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';

const envLabel = import.meta.env.VITE_ENV_LABEL as string | undefined;

export function Layout() {
  const { session, signOut } = useAuth();
  return (
    <>
      {envLabel && <div className="env-banner">{envLabel}: test data only</div>}
      <header className="site-header">
        <div className="site-header-inner">
          <span className="brand">WFSC Members</span>
          <nav aria-label="Main">
            <NavLink to="/" end>Members</NavLink>
            <NavLink to="/people/new">Add member</NavLink>
            <NavLink to="/badges">Badges</NavLink>
            <NavLink to="/settings/member-types">Member types</NavLink>
            <NavLink to="/import">Import</NavLink>
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
