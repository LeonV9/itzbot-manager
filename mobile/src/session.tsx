import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, configure, normalizeUrl, store } from './api';

interface Session {
  ready: boolean; serverUrl: string; token: string; username: string;
  testServer(url: string): Promise<void>; setServer(url: string): Promise<void>;
  signIn(u: string, p: string): Promise<void>; register(u: string, p: string): Promise<void>;
  setToken(t: string): Promise<void>; signOut(): Promise<void>;
}
const Ctx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState({ ready: false, serverUrl: '', token: '', username: '' });
  const signOut = useCallback(async () => { await store.clearToken(); configure({ token: '' }); setS((x) => ({ ...x, token: '' })); }, []);
  useEffect(() => {
    configure({ onUnauthorized: () => void signOut() });
    store.load().then((v) => { configure({ url: v.url, token: v.token }); setS({ ready: true, serverUrl: v.url, token: v.token, username: v.user }); });
  }, [signOut]);

  const value = useMemo<Session>(() => ({
    ...s,
    async testServer(url) {
      const prev = s.serverUrl; configure({ url });
      try { const r = await api.get<{ ok: boolean }>('/api/health'); if (!r?.ok) throw new ApiError('BAD_SERVER', 'That address answered, but it is not an ItzBot Manager server.'); }
      catch (e) { configure({ url: prev }); throw e; }
    },
    async setServer(url) { const u = normalizeUrl(url); await store.save('server_url', u); configure({ url: u }); setS((x) => ({ ...x, serverUrl: u })); },
    async signIn(u, p) { const r = await api.post<{ token: string; user: { username: string } }>('/api/auth/login', { username: u, password: p }); await value.setToken(r.token); await store.save('username', r.user.username); setS((x) => ({ ...x, username: r.user.username })); },
    async register(u, p) { const r = await api.post<{ token: string; user: { username: string } }>('/api/auth/register', { username: u, password: p }); await value.setToken(r.token); await store.save('username', r.user.username); setS((x) => ({ ...x, username: r.user.username })); },
    async setToken(t) { await store.save('token', t); configure({ token: t }); setS((x) => ({ ...x, token: t })); },
    signOut,
  }), [s, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
