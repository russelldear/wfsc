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

interface Section {
  label: string;
  active: boolean;
  items: { to: string; label: string; end?: boolean }[];
}

/** The menu sections this person can use. */
function useSections(): Section[] {
  const { hasRole } = useAuth();
  const { pathname } = useLocation();
  const committee = hasRole('committee');
  const admin = hasRole('admin');
  const sections: Section[] = [];
  if (committee) {
    sections.push({
      label: 'Members',
      active: pathname === '/' || pathname.startsWith('/people'),
      items: [
        { to: '/', label: 'Member list', end: true },
        { to: '/people/new', label: 'Add member' },
      ],
    });
  }
  if (committee || hasRole('coach')) {
    sections.push({
      label: 'Skate School',
      active: pathname.startsWith('/skate-school'),
      items: [{ to: '/skate-school', label: 'Terms and classes' }],
    });
  }
  if (admin) {
    sections.push({
      label: 'Admin',
      active: ['/access', '/import', '/settings', '/badges'].some((p) => pathname.startsWith(p)),
      items: [
        // Importing creates people, so it also needs the committee role.
        ...(committee ? [{ to: '/import', label: 'Import' }] : []),
        { to: '/settings/member-types', label: 'Member types' },
        { to: '/badges', label: 'Badges' },
        { to: '/access', label: 'Access' },
      ],
    });
  }
  return sections;
}

function AccountItems({ close }: { close: () => void }) {
  const { signOut } = useAuth();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  return (
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
  );
}

const Logo = () => <img src="logo-64.png" alt="" width={32} height={32} className="brand-logo" />;

export function Layout() {
  const { session } = useAuth();
  const sections = useSections();
  const email = session?.user.email;

  return (
    <>
      {envLabel && <div className="env-banner">{envLabel}: test data only</div>}
      <header className="site-header">
        {/* Wide screens: name links home, one menu per section, account menu on the right. */}
        <div className="site-header-inner header-wide">
          {/* Home: the member list for the committee; others are sent on to their first page. */}
          <Link to="/" className="brand">
            <Logo />
            Wellington Figure Skating Club
          </Link>
          <nav aria-label="Main" className="main-nav">
            {sections.map((s) => (
              <Menu key={s.label} label={s.label} active={s.active}>
                {() =>
                  s.items.map((i) => (
                    <MenuLink key={i.to} to={i.to} end={i.end}>
                      {i.label}
                    </MenuLink>
                  ))
                }
              </Menu>
            ))}
          </nav>
          <Menu label={<span className="user-email">{email}</span>} align="right">
            {(close) => <AccountItems close={close} />}
          </Menu>
        </div>

        {/* Narrow screens: everything in one menu under the club name. */}
        <div className="site-header-inner header-narrow">
          <Menu
            className="menu-mobile"
            label={
              <span className="brand">
                <Logo />
                Wellington Figure Skating Club
              </span>
            }
          >
            {(close) => (
              <nav aria-label="Main">
                {sections.map((s) => (
                  <div key={s.label} className="menu-section">
                    <div className="menu-heading">{s.label}</div>
                    {s.items.map((i) => (
                      <MenuLink key={i.to} to={i.to} end={i.end}>
                        {i.label}
                      </MenuLink>
                    ))}
                  </div>
                ))}
                <hr />
                <div className="menu-heading menu-email">{email}</div>
                <AccountItems close={close} />
              </nav>
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
