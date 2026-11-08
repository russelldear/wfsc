import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { AppRole } from '../lib/types';

type Status = 'loading' | 'signed-out' | 'no-access' | 'ready' | 'error';

interface AuthState {
  status: Status;
  session: Session | null;
  roles: AppRole[];
  hasRole: (role: AppRole) => boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Removes ?code=... left in the address bar after the Google sign-in redirect. */
function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('code') || url.searchParams.has('error')) {
    url.searchParams.delete('code');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    window.history.replaceState(null, '', url.toString());
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [roleStatus, setRoleStatus] = useState<Status>('loading');
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error: e }) => {
      if (e) setError(e.message);
      setSession(data.session);
      setSessionLoaded(true);
      cleanAuthParamsFromUrl();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('user_role')
      .select('role')
      .eq('user_id', userId)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) {
          setError(e.message);
          setRoleStatus('error');
        } else {
          const mine = data.map((r) => r.role as AppRole);
          setRoles(mine);
          // Admin alone gives the Access page; committee or coach give data.
          setRoleStatus(mine.length > 0 ? 'ready' : 'no-access');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  let status: Status;
  if (!sessionLoaded) status = 'loading';
  else if (!userId) status = 'signed-out';
  else status = roleStatus;

  const value: AuthState = {
    status,
    session,
    roles,
    hasRole: (role) => roles.includes(role),
    error,
    signIn: async () => {
      setError(null);
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (e) setError(e.message);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setRoleStatus('loading');
      setRoles([]);
      window.location.hash = '';
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
