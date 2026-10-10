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
  resetPassword: (token: string, password: string) => Promise<{ home: string }>;
  checkResetToken: (token: string) => Promise<void>;
  can: (resource: string, action: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

/** DEV-only stand-in used when no backend is reachable, so the whole app (every
 *  page on its mock fallback) is browsable for frontend work. Never used in a
 *  production build — see refresh(). Visit #/login to still see the sign-in screen. */
const DEV_USER: SessionUser = {
  id: 'dev-admin',
  fullName: 'Dev Admin',
  email: 'dev@theconts.com',
  role: 'management',
  mustChangePassword: false,
  locale: 'en-MY',
  permissions: [],
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await api.get<{ user: SessionUser }>('/auth/session');
      setUser(res.user);
    } catch {
      // DEV-only: with no backend running, sign in as an admin so every page is
      // reachable for frontend work. Stripped from production builds. Visit
      // #/login to still exercise the real sign-in screen.
      if (import.meta.env.DEV && !window.location.hash.startsWith('#/login')) {
        setUser(DEV_USER);
      } else {
        setUser(null);
      }
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

  /** Throws with the server's plain-language reason when no reset email went out (no account, switched off,
   *  too many requests, email not set up); the login screen shows that message. */
  const requestReset = async (email: string) => {
    await api.post('/auth/forgot-password', { email });
  };

  const changePassword = async (password: string) => {
    await api.post('/auth/change-password', { password });
    await refresh();
  };

  /** Completes the emailed reset link: verifies the token server-side and, on
   *  success, signs the person straight in — same shape as login(). */
  const resetPassword = async (token: string, password: string) => {
    const res = await api.post<{ user: SessionUser; home: string }>('/auth/reset-password', { token, password });
    setUser(res.user);
    window.location.hash = res.home;
    return { home: res.home };
  };

  /** Checked the moment a reset link opens, before anyone types a password —
   *  an already-used or expired token otherwise renders an identical form and
   *  only reveals the problem after a submit. Throws (ApiFailure) when invalid. */
  const checkResetToken = async (token: string) => {
    await api.get('/auth/reset-password', { token });
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
    <Ctx.Provider value={{ user, loading, login, logout, requestReset, changePassword, resetPassword, checkResetToken, can, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
