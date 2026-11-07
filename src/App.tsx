import { HashRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { CenteredCard, Layout } from './components/Layout';
import { ImportPage } from './pages/ImportPage';
import { MemberListPage } from './pages/MemberListPage';
import { MemberTypesPage } from './pages/MemberTypesPage';
import { PersonFormPage } from './pages/PersonFormPage';
import { PersonPage } from './pages/PersonPage';

function Gate() {
  const { status, session, error, signIn, signOut } = useAuth();

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

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MemberListPage />} />
          <Route path="people/new" element={<PersonFormPage />} />
          <Route path="people/:id" element={<PersonPage />} />
          <Route path="people/:id/edit" element={<PersonFormPage />} />
          <Route path="settings/member-types" element={<MemberTypesPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
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
