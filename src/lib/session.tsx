import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiFailure } from './api';
import type { SessionUser } from './types';

interface SessionCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<{ home: string }>;
  logout: () => Promise<void>;
  requestReset: (email: string) => Promise<void>;
  changePassword: (password: string) => Promise<void>;
  can: (resource: string, action: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

/** DEV-only mock so every screen is browsable without the Cloudflare/D1 backend.
 *  Guarded by import.meta.env.DEV and skipped when the address bar asks for
 *  #/login, so the real auth flow is still reachable in dev. Never ships to prod
 *  (import.meta.env.DEV is false in a production build). */
const DEV_USER: SessionUser = {
  id: 'dev-admin', fullName: 'Dev Admin', email: 'dev@theconts.com',
  role: 'management', mustChangePassword: false, locale: 'en-MY', permissions: [],
};
const wantsLogin = () => window.location.hash.slice(1).startsWith('/login');

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await api.get<{ user: SessionUser }>('/auth/session');
      setUser(res.user);
    } catch {
      if (import.meta.env.DEV && !wantsLogin()) setUser(DEV_USER);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const login = async (email: string, password: string, remember: boolean) => {
    const res = await api.post<{ user: SessionUser; home: string }>('/auth/login', { email, password, remember });
    setUser(res.user);
    window.location.hash = res.home;
    return { home: res.home };
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (e) { if (!(e instanceof ApiFailure)) throw e; }
    setUser(null);
    window.location.hash = '/';
  };

  /** Always resolves. The server returns the same body whether or not the
   *  account exists, so the UI must not branch on the result. */
  const requestReset = async (email: string) => {
    await api.post('/auth/forgot-password', { email });
  };

  const changePassword = async (password: string) => {
    await api.post('/auth/change-password', { password });
    await refresh();
  };

  /**
   * Permission strings arrive from the server as `resource:action` — built from
   * permissions.json. The client only uses them to decide what to render; the
   * server enforces independently on every request.
   */
  const can = (resource: string, action: string) => {
    if (import.meta.env.DEV && user?.id === 'dev-admin') return true;
    return !!user?.permissions?.includes(`${resource}:${action}`);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, requestReset, changePassword, can, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
