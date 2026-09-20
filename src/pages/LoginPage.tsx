import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';
import Icon from '../components/Icon';
import { Logo } from '../components/Logo';

type Screen = 'signin' | 'forgot' | 'change' | 'reset';

const COPY: Record<Screen, { eyebrow: string; heading: string; sub: string; submit: string }> = {
  signin: { eyebrow: 'PROPERTY OS', heading: 'Sign in', sub: 'Use the work email your administrator invited.', submit: 'Sign in' },
  forgot: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Reset password', sub: 'We will email you a reset link.', submit: 'Send reset link' },
  change: { eyebrow: 'FIRST SIGN-IN', heading: 'Set a new password', sub: 'Your invitation used a temporary password.', submit: 'Save and continue' },
  reset: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Set a new password', sub: 'Choose a new password for your account.', submit: 'Save and sign in' },
};

const STATS = [
  { value: '4.91', label: 'RATING' },
  { value: '86.2%', label: 'OCCUPANCY' },
  { value: '11', label: 'UNITS' },
];

export default function LoginPage({ forceChangePassword = false, resetToken = null }: { forceChangePassword?: boolean; resetToken?: string | null }) {
  const { login, requestReset, changePassword, resetPassword, checkResetToken } = useSession();
  const [screen, setScreen] = useState<Screen>(forceChangePassword ? 'change' : resetToken ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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

  const inputCls = 'block w-full box-border h-12 px-[14px] py-0 font-sans text-[14px] text-ink bg-white border border-solid border-line rounded-control [outline:none] [transition:border-color_150ms_ease-out,box-shadow_150ms_ease-out]';
  const labelCls = 'text-[11px] font-semibold tracking-[0.1em] text-muted-ink';

  return (
    <div className="flex-1 min-h-[980px] grid grid-cols-[minmax(0,1.55fr)_minmax(420px,0.62fr)]">
      {/* Brand stage. The photograph is the hero; type sits on a scrim, never on bare image. */}
      {/* The photograph is optional. Drop one at public/brand/login-hero.jpg and it
          appears; without it the blueprint grid carries the panel on its own, so a
          clean install never shows a broken image. */}
      <div className="bg-blueprint relative min-h-full [background:#151515]!">
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
            <h2 className="m-0 text-[56px] leading-[1.04] font-semibold tracking-[-0.025em] text-white text-pretty">
              Homes worth staying in.<br />Numbers worth trusting.
            </h2>
          </div>

          <div className="flex items-end justify-between gap-8 flex-wrap">
            <div className="flex gap-14 flex-wrap">
              {STATS.map(s => (
                <div key={s.label} className="flex flex-col gap-2">
                  <span className="text-[32px] leading-none font-semibold tracking-[-0.02em] text-white">{s.value}</span>
                  <span className="text-[11px] tracking-[0.16em] text-[#8A8680]">{s.label}</span>
                </div>
              ))}
            </div>
            <span className="text-[11px] tracking-[0.14em] text-[#8A8680]">KUALA LUMPUR · PETALING JAYA</span>
          </div>
        </div>
      </div>

      <div className="pt-12 px-14 pb-10 flex flex-col justify-between bg-white">
        <div className="flex items-center justify-end gap-2 text-[11px] tracking-[0.04em] text-faint">
          <Icon name="Lock" size="sm" />
          <span>Secure sign-in</span>
        </div>

        <form onSubmit={submit} className="w-full max-w-[344px] self-center flex flex-col gap-8">
          <div className="flex flex-col gap-2.5">
            <span className="text-[11px] font-semibold tracking-[0.2em] text-gold-ink">{c.eyebrow}</span>
            <h1 className="m-0 text-[32px] leading-[1.15] font-semibold tracking-[-0.015em]">{c.heading}</h1>
            <div className="text-[13.5px] text-muted-ink text-pretty">{c.sub}</div>
          </div>

          {error && <div role="alert" className="[border-left:2px_solid_#A8352F] bg-critical-bg py-3 px-[14px] text-[12px] text-[#A8352F]">{error}</div>}
          {sent && <div className="[border-left:2px_solid_#11694A] bg-success-bg py-3 px-[14px] text-[12px] text-[#11694A]">Reset link sent. It expires in 60 minutes.</div>}

          <div className="flex flex-col gap-5">
            {screen !== 'change' && screen !== 'reset' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className={labelCls}>EMAIL</label>
                <input id="email" type="email" required autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@theconts.com" className={inputCls} />
              </div>
            )}

            {screen === 'reset' && tokenState === 'checking' && (
              <div className="text-[12px] text-muted-ink">Checking your link…</div>
            )}

            {screen !== 'forgot' && (screen !== 'reset' || tokenState === 'valid') && (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="pw" className={labelCls}>{screen === 'change' || screen === 'reset' ? 'NEW PASSWORD' : 'PASSWORD'}</label>
                  <button type="button" onClick={() => setShow(v => !v)}
                    className="flex items-center gap-[5px] text-muted-ink bg-transparent [border:none] cursor-pointer [font:inherit]">
                    <Icon name={show ? 'EyeOff' : 'Eye'} size="sm" />
                    <span>{show ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <input id="pw" type={show ? 'text' : 'password'} required
                  autoComplete={screen === 'change' || screen === 'reset' ? 'new-password' : 'current-password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={screen === 'change' || screen === 'reset' ? 'New password' : 'Enter password'} className={inputCls} />
              </div>
            )}

            {(screen === 'change' || (screen === 'reset' && tokenState === 'valid')) && (
              <div className="flex flex-col gap-[9px] p-4 border border-solid border-line rounded-control bg-page">
                {policy.map(p => (
                  <div key={p.label} className="flex items-center gap-[9px] text-[12px]">
                    <span className={`w-[13px] text-center ${p.ok ? 'text-[#11694A]' : 'text-muted-ink'}`}>{p.ok ? '✓' : '○'}</span>
                    <span className={p.ok ? 'text-ink' : 'text-muted-ink'}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}

            {screen === 'signin' && (
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-[9px] cursor-pointer text-[12px] text-muted-ink">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-[#11694A] w-4 h-4" />
                  Keep me signed in
                </label>
                <button type="button" onClick={() => { setScreen('forgot'); setError(''); }}
                  className="text-muted-ink bg-transparent [border:none] cursor-pointer [font:inherit]">
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {screen === 'reset' && tokenState === 'invalid' ? (
            <button type="button" onClick={() => { window.location.hash = '/'; setScreen('forgot'); setError(''); }}
              className="flex items-center justify-center w-full box-border h-[50px] rounded-control bg-black text-white text-[14px] font-medium [border:none] cursor-pointer">
              Request a new link
            </button>
          ) : screen !== 'reset' || tokenState === 'valid' ? (
            <button type="submit" disabled={busy}
              className={`flex items-center justify-center gap-2 w-full box-border h-[50px] rounded-control bg-black text-white text-[14px] font-medium [border:none] [transition:background_120ms_ease-out] ${busy ? 'cursor-default opacity-60' : 'cursor-pointer opacity-100'}`}>
              {busy && <span className="animate-spin w-[14px] h-[14px] rounded-full border-2 border-solid border-[rgba(255,255,255,0.35)] border-t-white" />}
              <span>{c.submit}</span>
            </button>
          ) : null}

          {screen !== 'signin' && !forceChangePassword && (
            <button type="button" onClick={() => { if (resetToken) window.location.hash = '/'; setScreen('signin'); setError(''); setSent(false); }}
              className="self-center text-muted-ink bg-transparent [border:none] cursor-pointer [font:inherit]">
              Back to sign in
            </button>
          )}
        </form>

        <div className="flex items-center justify-between gap-4 flex-wrap text-[11px] text-faint">
          <span>The Conts Sdn Bhd · 202301027399</span>
          <span>+60 17-465 8868</span>
        </div>
      </div>
    </div>
  );
}
