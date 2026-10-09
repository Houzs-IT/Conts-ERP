import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';
import Icon from '../components/Icon';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { Field, PasswordField } from '../components/Field';

type Screen = 'signin' | 'forgot' | 'change' | 'reset';

const COPY: Record<Screen, { eyebrow: string; heading: string; sub: string; submit: string }> = {
  signin: { eyebrow: 'CONTS ERP', heading: 'Sign in', sub: 'Use the work email your administrator invited.', submit: 'Sign in' },
  forgot: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Reset password', sub: 'We will email you a reset link.', submit: 'Send reset link' },
  change: { eyebrow: 'FIRST SIGN-IN', heading: 'Set a new password', sub: 'Your invitation used a temporary password.', submit: 'Save and continue' },
  reset: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Set a new password', sub: 'Choose a new password for your account.', submit: 'Save and sign in' },
};


export default function LoginPage({ forceChangePassword = false, resetToken = null }: { forceChangePassword?: boolean; resetToken?: string | null }) {
  const { login, requestReset, changePassword, resetPassword, checkResetToken } = useSession();
  const [screen, setScreen] = useState<Screen>(forceChangePassword ? 'change' : resetToken ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // Checked the moment the link opens, before anyone types a password — an
  // already-used or expired link otherwise renders an identical form and only
  // reveals the problem after a submit.
  const [tokenState, setTokenState] = useState<'checking' | 'valid' | 'invalid'>(resetToken ? 'checking' : 'valid');

  useEffect(() => {
    if (!resetToken) return;
    let live = true;
    // Reset to "checking" immediately, not just on first mount — otherwise a
    // second link opened in the same tab session would keep showing whichever
    // stale result (form or error) the previous token left behind until the
    // new check resolves.
    setTokenState('checking');
    setError('');
    checkResetToken(resetToken)
      .then(() => { if (live) setTokenState('valid'); })
      .catch((err: any) => {
        if (!live) return;
        setTokenState('invalid');
        setError(err?.message ?? 'This reset link is invalid or has expired. Request a new one.');
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetToken alone identifies this link
  }, [resetToken]);
  // owner.theconts.com is the owners' door; the server refuses staff there too.
  const ownerDoor = window.location.hostname.split('.')[0] === 'owner';
  const c = ownerDoor && screen === 'signin'
    ? { ...COPY.signin, eyebrow: 'OWNER PORTAL', sub: 'Use the email The Conts registered for your property.' }
    : COPY[screen];

  const policy = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'At least 1 uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'At least 1 digit', ok: /[0-9]/.test(password) },
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (screen === 'forgot') { await requestReset(email); setSent(true); }
      else if (screen === 'change') { await changePassword(password); }
      else if (screen === 'reset') { await resetPassword(resetToken!, password); }
      else { await login(email, password, remember); }
    } catch (err: any) {
      setError(err?.message ?? 'Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const labelCaps = 'text-caption font-semibold uppercase tracking-[0.06em]';
  const newPassword = screen === 'change' || screen === 'reset';

  return (
    <div className="flex-1 min-h-screen lg:min-h-[980px] grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(420px,0.62fr)]">
      {/* Brand stage. The photograph is the hero; type sits on a scrim, never on bare image. */}
      {/* The photograph is optional. Drop one at public/brand/login-hero.jpg and it
          appears; without it the blueprint grid carries the panel on its own, so a
          clean install never shows a broken image. */}
      <div className="hidden lg:block bg-blueprint relative min-h-full [background:#151515]!">
        <div
          aria-hidden
          className="absolute inset-0 bg-[url(/brand/login-hero.jpg)] bg-cover bg-center"
        />
        <div className="absolute inset-0 [background:linear-gradient(180deg,rgba(21,21,21,0.62)_0%,rgba(21,21,21,0.12)_40%,rgba(21,21,21,0.88)_100%)]" />
        <div className="absolute inset-[26px] border border-solid border-[rgba(200,164,106,0.24)]" />

        <div className="relative min-h-full box-border py-[52px] px-[64px] flex flex-col justify-between gap-9">
          <Logo variant="full" size="lg" onDark />

          <div className="flex flex-col gap-[26px] max-w-[620px]">
            <div className="h-px w-[72px] bg-gold" />
            {/* Display type for the public hero only; the in-app scale stops at 26. */}
            <h2 className="m-0 text-[56px] leading-[1.04] font-semibold tracking-[-0.025em] text-white text-pretty">
              Homes worth staying in.<br />Numbers worth trusting.
            </h2>
          </div>

          <div className="flex items-end justify-between gap-8 flex-wrap">
            <span className="text-heading text-white text-pretty max-w-[420px]">
              Short-term rental management for owners, units, bookings and payouts.
            </span>
            <span className={`${labelCaps} text-[var(--color-text-on-dark-muted)]`}>KUALA LUMPUR · PETALING JAYA</span>
          </div>
        </div>
      </div>

      <div className="pt-8 px-4 pb-8 sm:pt-12 sm:px-14 sm:pb-10 flex flex-col justify-between gap-8 bg-white">
        <div className="flex items-center justify-between lg:justify-end gap-2">
          <span className="lg:hidden"><Logo variant="full" size="sm" /></span>
          <span className="flex items-center gap-2 text-caption text-faint">
            <Icon name="Lock" size="sm" />
            <span>Secure sign-in</span>
          </span>
        </div>

        <form onSubmit={submit} className="w-full max-w-[344px] self-center flex flex-col gap-8">
          <div className="flex flex-col gap-2.5">
            <span className={`${labelCaps} text-gold-ink`}>{c.eyebrow}</span>
            <h1 className="m-0 text-headline leading-[1.15] font-semibold tracking-[-0.01em]">{c.heading}</h1>
            <div className="text-copy text-muted-ink text-pretty">{c.sub}</div>
          </div>

          {error && <div role="alert" className="[border-left:2px_solid_var(--color-critical-line)] bg-critical-bg py-3 px-3.5 text-meta text-[var(--color-critical-fg)]">{error}</div>}
          {sent && <div className="[border-left:2px_solid_var(--color-success-line)] bg-success-bg py-3 px-3.5 text-meta text-[var(--color-success-fg)]">Reset link sent. It expires in 60 minutes.</div>}

          <div className="flex flex-col gap-5">
            {screen !== 'change' && screen !== 'reset' && (
              <Field label="Email" type="email" required autoComplete="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@theconts.com" />
            )}

            {screen === 'reset' && tokenState === 'checking' && (
              <div className="text-meta text-muted-ink">Checking your link…</div>
            )}

            {screen !== 'forgot' && (screen !== 'reset' || tokenState === 'valid') && (
              <PasswordField label={newPassword ? 'New password' : 'Password'} required
                autoComplete={newPassword ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder={newPassword ? 'New password' : 'Enter password'} />
            )}

            {(screen === 'change' || (screen === 'reset' && tokenState === 'valid')) && (
              <div className="flex flex-col gap-2 p-4 border border-solid border-line rounded-control bg-page">
                {policy.map(p => (
                  <div key={p.label} className="flex items-center gap-2 text-meta">
                    <span className={`w-[13px] text-center ${p.ok ? 'text-[var(--color-success-fg)]' : 'text-muted-ink'}`}>{p.ok ? '✓' : '○'}</span>
                    <span className={p.ok ? 'text-ink' : 'text-muted-ink'}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}

            {screen === 'signin' && (
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 min-h-10 cursor-pointer text-meta text-muted-ink">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-[var(--color-success-fg)] w-4 h-4" />
                  Keep me signed in
                </label>
                <Button type="button" variant="tertiary" size="md" style={{ paddingInline: 8, marginRight: -8 }}
                  onClick={() => { setScreen('forgot'); setError(''); }}>
                  Forgot password?
                </Button>
              </div>
            )}
          </div>

          {screen === 'reset' && tokenState === 'invalid' ? (
            <Button type="button" variant="primary" size="touch" style={{ width: '100%' }}
              onClick={() => { window.location.hash = '/'; setScreen('forgot'); setError(''); }}>
              Request a new link
            </Button>
          ) : screen !== 'reset' || tokenState === 'valid' ? (
            <Button type="submit" variant="primary" size="touch" loading={busy} style={{ width: '100%' }}>
              {c.submit}
            </Button>
          ) : null}

          {screen !== 'signin' && !forceChangePassword && (
            <Button type="button" variant="tertiary" size="md" className="self-center"
              onClick={() => { if (resetToken) window.location.hash = '/'; setScreen('signin'); setError(''); setSent(false); }}>
              Back to sign in
            </Button>
          )}
        </form>

        <div className="flex items-center justify-between gap-4 flex-wrap text-caption text-faint">
          <span>The Conts Sdn Bhd · 202301027399</span>
          <span>+60 17-465 8868</span>
        </div>
      </div>
    </div>
  );
}
