import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ApiError } from './api';

/** Loads data when the screen is focused and refreshes it on an interval while visible. */
export function usePoll<T>(fn: () => Promise<T>, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const load = useCallback(async () => {
    try { setData(await fnRef.current()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); const t = setInterval(() => void load(), ms); return () => clearInterval(t); }, [load, ms]));
  return { data, error, loading, reload: load };
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/** Runs an async action with a busy flag and an error callback. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, f: () => Promise<unknown>, onError: (m: string) => void) => {
    setBusy(key); try { await f(); } catch (e) { onError(errMsg(e)); } finally { setBusy(null); }
  }, []);
  return { busy, run };
}
