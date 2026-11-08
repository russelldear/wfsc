import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';
import { Menu, MenuLink } from './Menu';

const envLabel = import.meta.env.VITE_ENV_LABEL as string | undefined;

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Layout() {
  const { session, signOut, hasRole } = useAuth();
  const { pathname } = useLocation();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const committee = hasRole('committee');
  const admin = hasRole('admin');
  const skateSchool = committee || hasRole('coach');

  const inMembers = pathname === '/' || pathname.startsWith('/people');
  const inSkateSchool = pathname.startsWith('/skate-school');
  const inAdmin = ['/access', '/import', '/settings', '/badges'].some((p) => pathname.startsWith(p));

  return (
    <>
      {envLabel && <div className="env-banner">{envLabel}: test data only</div>}
      <header className="site-header">
        <div className="site-header-inner">
          {/* Home: the member list for the committee; others are sent on to their first page. */}
          <Link to="/" className="brand">
            <img src="logo-64.png" alt="" width={32} height={32} className="brand-logo" />
            Wellington Figure Skating Club
          </Link>
          <nav aria-label="Main" className="main-nav">
            {committee && (
              <Menu label="Members" active={inMembers}>
                {() => (
                  <>
                    <MenuLink to="/" end>
                      Member list
                    </MenuLink>
                    <MenuLink to="/people/new">Add member</MenuLink>
                  </>
                )}
              </Menu>
            )}
            {skateSchool && (
              <Menu label="Skate School" active={inSkateSchool}>
                {() => <MenuLink to="/skate-school">Terms and classes</MenuLink>}
              </Menu>
            )}
            {admin && (
              <Menu label="Admin" active={inAdmin}>
                {() => (
                  <>
                    {/* Importing creates people, so it also needs the committee role. */}
                    {committee && <MenuLink to="/import">Import</MenuLink>}
                    <MenuLink to="/settings/member-types">Member types</MenuLink>
                    <MenuLink to="/badges">Badges</MenuLink>
                    <MenuLink to="/access">Access</MenuLink>
                  </>
                )}
              </Menu>
            )}
          </nav>
          <Menu label={<span className="user-email">{session?.user.email}</span>} align="right">
            {(close) => (
              <>
                <div className="menu-heading" id="theme-heading">
                  Theme
                </div>
                <div role="group" aria-labelledby="theme-heading">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className="menu-item"
                      aria-pressed={theme === t.value}
                      onClick={() => {
                        setThemeChoice(t.value);
                        setTheme(t.value);
                        close();
                      }}
                    >
                      <span className="menu-check" aria-hidden="true">
                        {theme === t.value ? '●' : ''}
                      </span>
                      {t.label}
                    </button>
                  ))}
                </div>
                <hr />
                <button type="button" className="menu-item" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            )}
          </Menu>
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
