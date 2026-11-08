import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { CenteredCard, Layout } from './components/Layout';
import { AccessPage } from './pages/AccessPage';
import { BadgesPage } from './pages/BadgesPage';
import { ClassPage } from './pages/ClassPage';
import { ImportPage } from './pages/ImportPage';
import { MemberListPage } from './pages/MemberListPage';
import { MemberTypesPage } from './pages/MemberTypesPage';
import { PersonFormPage } from './pages/PersonFormPage';
import { PersonPage } from './pages/PersonPage';
import { SkateSchoolPage } from './pages/SkateSchoolPage';

function Gate() {
  const { status, session, error, signIn, signOut, hasRole } = useAuth();

  if (status === 'loading') {
    return <CenteredCard>Loading…</CenteredCard>;
  }

  if (status === 'signed-out') {
    return (
      <CenteredCard>
        <h1>WFSC Members</h1>
        <p>Sign in with the Google account the committee has registered for you.</p>
        <button type="button" className="primary" onClick={() => void signIn()}>
          Sign in with Google
        </button>
        {error && <p className="error">{error}</p>}
      </CenteredCard>
    );
  }

  if (status === 'no-access' || status === 'error') {
    return (
      <CenteredCard>
        <h1>No access yet</h1>
        <p>
          You are signed in as <strong>{session?.user.email}</strong>, but this account has not
          been given access. Ask a committee administrator to grant it.
        </p>
        {error && <p className="error">{error}</p>}
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </CenteredCard>
    );
  }

  const committee = hasRole('committee');
  const skateSchool = committee || hasRole('coach');
  const admin = hasRole('admin');
  // Where to land: the member list for the committee, otherwise the first
  // page this person can use.
  const home = committee ? null : skateSchool ? '/skate-school' : admin ? '/access' : null;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          {committee ? (
            <>
              <Route index element={<MemberListPage />} />
              <Route path="people/new" element={<PersonFormPage />} />
              <Route path="people/:id" element={<PersonPage />} />
              <Route path="people/:id/edit" element={<PersonFormPage />} />
            </>
          ) : (
            home && <Route index element={<Navigate to={home} replace />} />
          )}
          {skateSchool && (
            <>
              <Route path="skate-school" element={<SkateSchoolPage />} />
              <Route path="skate-school/classes/:id" element={<ClassPage />} />
            </>
          )}
          {admin && (
            <>
              <Route path="settings/member-types" element={<MemberTypesPage />} />
              <Route path="badges" element={<BadgesPage />} />
              <Route path="access" element={<AccessPage />} />
            </>
          )}
          {admin && committee && <Route path="import" element={<ImportPage />} />}
          <Route path="*" element={<p>Page not found, or you don't have access to it.</p>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
