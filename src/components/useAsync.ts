import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../lib/api';

interface State<T> {
  requestKey: string;
  data: T | null;
  error: string | null;
}

/**
 * Loads data on mount and whenever `deps` change. `reload` refetches while
 * keeping the current data on screen. Data loaded for different deps is never
 * returned, so a page never shows one person's details under another's URL.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const depsKey = JSON.stringify(deps);
  const [version, setVersion] = useState(0);
  const requestKey = `${depsKey}#${version}`;
  const [state, setState] = useState<State<T>>({ requestKey: '', data: null, error: null });

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ requestKey, data, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setState((s) => ({ requestKey, data: s.data, error: friendlyError(e) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const sameDeps = state.requestKey.slice(0, state.requestKey.lastIndexOf('#')) === depsKey;
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    data: sameDeps ? state.data : null,
    error: sameDeps ? state.error : null,
    loading: state.requestKey !== requestKey,
    reload,
  };
}
