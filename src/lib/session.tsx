import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiFailure } from './api';
import { twoStepPrompt } from './twoStepPrompt';
import { invalidateCachePrefix } from './cached-fetch';
import type { SessionUser } from './types';
import { go } from './go';

/** The password was right and the account has two-step sign-in on: the code is asked for next. */
export interface TwoStep { challenge: string; backupOnly: boolean }
type SignedIn = { home: string; twoStep?: undefined } | { home?: undefined; twoStep: TwoStep };

interface SessionCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<SignedIn>;
  loginPin: (employeeId: string, pin: string) => Promise<SignedIn>;
  verifyCode: (challenge: string, code: string) => Promise<SignedIn>;
  logout: () => Promise<void>;
  requestReset: (email: string) => Promise<void>;
  changePassword: (password: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<SignedIn>;
  checkResetToken: (token: string) => Promise<void>;
  can: (resource: string, action: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

/** DEV-only stand-in used when no backend is reachable, so the whole app (every
 *  page on its mock fallback) is browsable for frontend work. Never used in a
 *  production build — see refresh(). Visit /login to still see the sign-in screen. */
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
      // /login to still exercise the real sign-in screen.
      if (import.meta.env.DEV && !window.location.pathname.startsWith('/login')) {
        setUser(DEV_USER);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const again = () => { void refresh(); };
    window.addEventListener('conts:password-change-required', again);
    return () => window.removeEventListener('conts:password-change-required', again);
  }, []);

  type SignInAnswer = { user: SessionUser; home: string; twoStep?: undefined } | { twoStep: true; challenge: string; backupOnly: boolean };
  const finish = (res: SignInAnswer): SignedIn => {
    if (res.twoStep) return { twoStep: { challenge: res.challenge, backupOnly: res.backupOnly } };
    setUser(res.user);
    go(res.home);
    return { home: res.home };
  };

  const login = async (email: string, password: string, remember: boolean) => {
    const done = finish(await api.post<SignInAnswer>('/auth/login', { email, password, remember }));
    // Signed in with the password alone: they have no second step yet, so the next screen offers it.
    if (!done.twoStep) twoStepPrompt.raise();
    return done;
  };

  /** Cleaners and technicians given app access on Workers: employee ID (EMP-001) and 6-digit PIN. */
  const loginPin = async (employeeId: string, pin: string) => finish(await api.post<SignInAnswer>('/auth/login-pin', { employeeId, pin }));

  /** The second step: a code from the authenticator app or a backup code. */
  const verifyCode = async (challenge: string, code: string) =>
    finish(await api.post<SignInAnswer>('/auth/login-2fa', { challenge, code }));

  const logout = async () => {
    // Cleaners and technicians go back to their own door (/portal opens the PIN sign-in), the office to /.
    const worker = user?.role === 'housekeeper' || user?.role === 'technician';
    try { await api.post('/auth/logout'); } catch (e) { if (!(e instanceof ApiFailure)) throw e; }
    setUser(null);
    // Cached reads are kept per browser, not per person: the next person on a shared phone or desk must not see them.
    invalidateCachePrefix('');
    go(worker ? '/portal' : '/');
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
  const resetPassword = async (token: string, password: string) =>
    finish(await api.post<SignInAnswer>('/auth/reset-password', { token, password }));

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
    <Ctx.Provider value={{ user, loading, login, loginPin, verifyCode, logout, requestReset, changePassword, resetPassword, checkResetToken, can, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
