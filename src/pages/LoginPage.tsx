import { useEffect, useState, type FormEvent } from 'react';
import { useSession, type TwoStep } from '../lib/session';
import { ApiFailure, api } from '../lib/api';
import { phone } from '../lib/format';
import Icon from '../components/Icon';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { Field, PasswordField } from '../components/Field';
import { CodeInput } from '../components/inputs';
import '../styles/login.css';

type Screen = 'signin' | 'forgot' | 'change' | 'reset' | 'code';

const COPY: Record<Screen, { eyebrow: string; heading: string; sub: string; submit: string }> = {
  signin: { eyebrow: 'CONTS ERP', heading: 'Sign in', sub: 'Use the work email your administrator invited.', submit: 'Sign in' },
  forgot: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Reset password', sub: 'We will email you a reset link.', submit: 'Send reset link' },
  change: { eyebrow: 'NEW PASSWORD', heading: 'Set a new password', sub: 'You signed in with a temporary password. Choose your own to continue.', submit: 'Save and continue' },
  reset: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Set a new password', sub: 'Choose a new password for your account.', submit: 'Save and sign in' },
  code: { eyebrow: 'TWO-STEP SIGN-IN', heading: 'Enter your code', sub: 'Open your authenticator app and enter the 6-digit code for Conts ERP.', submit: 'Verify and sign in' },
};


const SUPPORT_PHONE = '+60 11-6133 3289';

export default function LoginPage({ forceChangePassword = false, resetToken = null }: { forceChangePassword?: boolean; resetToken?: string | null }) {
  const { login, verifyCode, requestReset, changePassword, resetPassword, checkResetToken } = useSession();
  const [screen, setScreen] = useState<Screen>(forceChangePassword ? 'change' : resetToken ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supportPhone, setSupportPhone] = useState(SUPPORT_PHONE);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // Set once the password is right on an account with two-step sign-in; the code is asked for next.
  const [twoStep, setTwoStep] = useState<TwoStep | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  // Checked the moment the link opens, before anyone types a password — an
  // already-used or expired link otherwise renders an identical form and only
  // reveals the problem after a submit.
  const [tokenState, setTokenState] = useState<'checking' | 'valid' | 'invalid'>(resetToken ? 'checking' : 'valid');

  useEffect(() => {
    let live = true;
    api.get<{ supportPhone: string }>('/settings/public')
      .then(r => { if (live && r?.supportPhone) setSupportPhone(r.supportPhone); })
      .catch(() => { /* the number above is shown instead */ });
    return () => { live = false; };
  }, []);

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
    ? { ...COPY.signin, eyebrow: 'OWNER PORTAL', sub: 'Use the email The Conts registered for your unit.' }
    : screen === 'code' && useBackup
      ? { ...COPY.code, heading: 'Enter a backup code', sub: 'Use one of the ten backup codes you saved when you set up two-step sign-in. Each works once.' }
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
      else if (screen === 'code') { await verifyCode(twoStep!.challenge, code); }
      else {
        const res = screen === 'reset' ? await resetPassword(resetToken!, password) : await login(email, password, remember);
        if (res.twoStep) {
          setTwoStep(res.twoStep); setUseBackup(res.twoStep.backupOnly); setCode(''); setScreen('code');
        }
      }
    } catch (err: any) {
      // The five minutes between password and code ran out: start again from the password.
      if (err instanceof ApiFailure && err.code === 'CHALLENGE_EXPIRED') { setTwoStep(null); setScreen('signin'); setPassword(''); }
      setError(err?.message ?? 'Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const labelCaps = 'text-caption font-semibold uppercase tracking-[0.06em]';
  const newPassword = screen === 'change' || screen === 'reset';

  // Decorative motion only. Pauses while the tab is hidden so the photograph and
  // light layer do not run in the background. Has no effect on sign-in.
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const onVis = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const headline = <>Homes worth staying in.<br />Numbers worth trusting.</>;

  return (
    <div
      data-hidden={pageHidden ? 'true' : 'false'}
      className="conts-login flex-1 min-h-[100dvh] lg:h-[100dvh] grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(420px,0.62fr)]"
    >
      {/* Hero. Photograph and light are decorative and clipped to this panel only.
          Drop a photograph at public/brand/login-hero.jpg; without one the blueprint
          grid carries the panel, so a clean install never shows a broken image. */}
      <div className="login-hero bg-blueprint relative overflow-hidden h-[236px] sm:h-[288px] lg:h-auto">
        <div aria-hidden className="login-photo absolute inset-[-3%] bg-[url(/brand/login-hero.jpg)] bg-cover bg-center" />
        <div aria-hidden className="login-light absolute inset-[-20%] pointer-events-none" />
        <div aria-hidden className="login-scrim absolute inset-0 pointer-events-none" />
        <div aria-hidden className="hidden lg:block absolute inset-[26px] border border-solid border-[rgba(200,164,106,0.24)] pointer-events-none" />

        {/* Desktop composition */}
        <div className="relative hidden lg:flex h-full box-border py-[52px] px-[64px] flex-col justify-between gap-9">
          <div className="login-in login-in-1"><Logo variant="full" size="lg" onDark /></div>

          <div className="login-in login-in-2 flex flex-col gap-[26px] max-w-[620px]">
            <div className="login-rule h-px w-[72px] bg-gold" />
            {/* Display type for the public hero only; the in-app scale stops at 26. */}
            <h2 className="m-0 text-[56px] leading-[1.04] font-semibold tracking-[-0.025em] text-white text-pretty">{headline}</h2>
          </div>

          <div className="login-in login-in-3 flex items-end justify-between gap-8 flex-wrap">
            <span className="text-heading text-white text-pretty max-w-[420px]">
              Short-term rental management for owners, units, reservations and owner payouts.
            </span>
            <span className={`${labelCaps} text-[var(--color-text-on-dark-muted)]`}>KUALA LUMPUR · PETALING JAYA</span>
          </div>
        </div>

        {/* Phone and tablet: compact image header, same wording */}
        <div className="relative lg:hidden h-full box-border px-5 pt-6 pb-11 sm:px-10 flex flex-col justify-between">
          <div className="login-in login-in-1"><Logo variant="full" size="sm" onDark /></div>
          <div className="login-in login-in-2 flex flex-col gap-3">
            <div className="login-rule h-px w-12 bg-gold" />
            <h2 className="m-0 text-[26px] sm:text-[32px] leading-[1.08] font-semibold tracking-[-0.02em] text-white text-pretty">{headline}</h2>
          </div>
        </div>
      </div>

      {/* Form side. Steady: a single opacity fade that never blocks input. */}
      <div className="login-panel relative -mt-6 lg:mt-0 rounded-t-[20px] lg:rounded-none pt-8 px-5 pb-8 sm:pt-12 sm:px-14 sm:pb-10 flex flex-col justify-between gap-8 bg-white lg:overflow-y-auto">
        <div className="flex items-center justify-end gap-2">
          <span className="flex items-center gap-2 text-caption text-faint">
            <Icon name="Lock" size="sm" />
            <span>Secure sign-in</span>
          </span>
        </div>

        <form onSubmit={submit} className="login-form login-in login-in-form w-full max-w-[344px] self-center flex flex-col gap-8">
          <div className="flex flex-col gap-2.5">
            <span className={`${labelCaps} text-gold-ink`}>{c.eyebrow}</span>
            <h1 className="m-0 text-headline leading-[1.15] font-semibold tracking-[-0.01em]">{c.heading}</h1>
            <div className="text-copy text-muted-ink text-pretty">{c.sub}</div>
          </div>

          {error && <div role="alert" className="[border-left:2px_solid_var(--color-critical-line)] bg-critical-bg py-3 px-3.5 text-meta text-danger">{error}</div>}
          {sent && <div className="[border-left:2px_solid_var(--color-success-line)] bg-success-bg py-3 px-3.5 text-meta text-success">Reset link sent. It expires in 60 minutes.</div>}

          <div className="flex flex-col gap-5">
            {screen === 'code' && (
              <>
                {useBackup
                  ? <Field label="Backup code" required autoFocus value={code} autoComplete="one-time-code" maxLength={11}
                      onChange={e => setCode(e.target.value.trim())} placeholder="xxxxx-xxxxx"
                      style={{ letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums' }} />
                  : <CodeInput required autoFocus value={code} onChange={setCode} />}
                {!twoStep?.backupOnly && (
                  <Button type="button" variant="tertiary" size="md" className="self-start" style={{ paddingInline: 0 }}
                    onClick={() => { setUseBackup(b => !b); setCode(''); setError(''); }}>
                    {useBackup ? 'Use the code from my app' : 'I do not have my phone: use a backup code'}
                  </Button>
                )}
              </>
            )}

            {screen !== 'change' && screen !== 'reset' && screen !== 'code' && (
              <Field label="Email" type="email" required autoComplete="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@theconts.com" />
            )}

            {screen === 'reset' && tokenState === 'checking' && (
              <div className="text-meta text-muted-ink">Checking your link…</div>
            )}

            {screen !== 'forgot' && screen !== 'code' && (screen !== 'reset' || tokenState === 'valid') && (
              <PasswordField label={newPassword ? 'New password' : 'Password'} required
                autoComplete={newPassword ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder={newPassword ? 'New password' : 'Enter password'} />
            )}

            {(screen === 'change' || (screen === 'reset' && tokenState === 'valid')) && (
              <div className="flex flex-col gap-2 p-4 border border-solid border-line rounded-control bg-page">
                {policy.map(p => (
                  <div key={p.label} className="flex items-center gap-2 text-meta">
                    <span className={`w-[13px] text-center ${p.ok ? 'text-success' : 'text-muted-ink'}`}>{p.ok ? '✓' : '○'}</span>
                    <span className={p.ok ? 'text-ink' : 'text-muted-ink'}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}

            {screen === 'signin' && (
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 min-h-10 cursor-pointer text-meta text-muted-ink">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-success w-4 h-4" />
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
            <Button type="button" variant="primary" size="touch" className="login-submit" style={{ width: '100%' }}
              onClick={() => { window.location.hash = '/'; setScreen('forgot'); setError(''); }}>
              Request a new link
            </Button>
          ) : screen !== 'reset' || tokenState === 'valid' ? (
            <Button type="submit" variant="primary" size="touch" loading={busy} className="login-submit" style={{ width: '100%' }}>
              {c.submit}
            </Button>
          ) : null}

          {screen !== 'signin' && !forceChangePassword && (
            <Button type="button" variant="tertiary" size="md" className="self-center"
              onClick={() => { if (resetToken) window.location.hash = '/'; setScreen('signin'); setError(''); setSent(false); setTwoStep(null); setPassword(''); }}>
              Back to sign in
            </Button>
          )}
        </form>

        <div className="flex items-center justify-between gap-4 flex-wrap text-caption text-faint">
          <span>The Conts Sdn Bhd · 202301027399</span>
          <span>{phone(supportPhone) || supportPhone}</span>
        </div>
      </div>
    </div>
  );
}
