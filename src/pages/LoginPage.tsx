import { useState, type CSSProperties, type FormEvent } from 'react';
import { color, radius, text, motion, font } from '../theme';
import { useSession } from '../lib/session';
import Icon from '../components/Icon';
import { Logo } from '../components/Logo';

type Screen = 'signin' | 'forgot' | 'change';

const COPY: Record<Screen, { eyebrow: string; heading: string; sub: string; submit: string }> = {
  signin: { eyebrow: 'PROPERTY OS', heading: 'Sign in', sub: 'Use the work email your administrator invited.', submit: 'Sign in' },
  forgot: { eyebrow: 'ACCOUNT RECOVERY', heading: 'Reset password', sub: 'We will email you a reset link.', submit: 'Send reset link' },
  change: { eyebrow: 'FIRST SIGN-IN', heading: 'Set a new password', sub: 'Your invitation used a temporary password.', submit: 'Save and continue' },
};

const STATS = [
  { value: '4.91', label: 'RATING' },
  { value: '86.2%', label: 'OCCUPANCY' },
  { value: '11', label: 'UNITS' },
];

export default function LoginPage({ forceChangePassword = false }: { forceChangePassword?: boolean }) {
  const { login, requestReset, changePassword } = useSession();
  const [screen, setScreen] = useState<Screen>(forceChangePassword ? 'change' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const c = COPY[screen];

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
      else { await login(email, password, remember); }
    } catch (err: any) {
      setError(err?.message ?? 'Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const input: CSSProperties = {
    display: 'block', width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px',
    fontFamily: font.sans, fontSize: text.body, color: color.ink, background: '#FFFFFF',
    border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none',
    transition: `border-color 150ms ease-out, box-shadow 150ms ease-out`,
  };
  const label: CSSProperties = { fontSize: text.micro, fontWeight: 600, letterSpacing: '0.1em', color: color.textMuted };

  return (
    <div style={{ flex: 1, minHeight: 980, display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(420px,0.62fr)' }}>
      {/* Brand stage. The photograph is the hero; type sits on a scrim, never on bare image. */}
      {/* The photograph is optional. Drop one at public/brand/login-hero.jpg and it
          appears; without it the blueprint grid carries the panel on its own, so a
          clean install never shows a broken image. */}
      <div className="bg-blueprint" style={{ position: 'relative', minHeight: '100%', background: color.black }}>
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'url(/brand/login-hero.jpg)',
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(21,21,21,0.62) 0%, rgba(21,21,21,0.12) 40%, rgba(21,21,21,0.88) 100%)' }} />
        <div style={{ position: 'absolute', inset: 26, border: '1px solid rgba(200,164,106,0.24)' }} />

        <div style={{ position: 'relative', minHeight: '100%', boxSizing: 'border-box', padding: '52px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 36 }}>
          <Logo variant="full" size="lg" onDark />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 26, maxWidth: 620 }}>
            <div style={{ height: 1, width: 72, background: color.gold }} />
            <h2 style={{ margin: 0, fontSize: 56, lineHeight: 1.04, fontWeight: 600, letterSpacing: '-0.025em', color: '#FFFFFF', textWrap: 'pretty' }}>
              Homes worth staying in.<br />Numbers worth trusting.
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
              {STATS.map(s => (
                <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 32, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em', color: '#FFFFFF' }}>{s.value}</span>
                  <span style={{ fontSize: text.micro, letterSpacing: '0.16em', color: color.dim }}>{s.label}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: text.micro, letterSpacing: '0.14em', color: color.dim }}>KUALA LUMPUR · PETALING JAYA</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '48px 56px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, fontSize: text.micro, letterSpacing: '0.04em', color: color.faint }}>
          <Icon name="Lock" size="sm" />
          <span>Secure sign-in</span>
        </div>

        <form onSubmit={submit} style={{ width: '100%', maxWidth: 344, alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.2em', color: color.goldInk }}>{c.eyebrow}</span>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.015em' }}>{c.heading}</h1>
            <div style={{ fontSize: 13.5, color: color.textMuted, textWrap: 'pretty' }}>{c.sub}</div>
          </div>

          {error && <div role="alert" style={{ borderLeft: '2px solid #A8352F', background: '#FCECEB', padding: '12px 14px', fontSize: text.small, color: '#A8352F' }}>{error}</div>}
          {sent && <div style={{ borderLeft: '2px solid #11694A', background: '#E9F5EF', padding: '12px 14px', fontSize: text.small, color: '#11694A' }}>Reset link sent. It expires in 60 minutes.</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {screen !== 'change' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="email" style={label}>EMAIL</label>
                <input id="email" type="email" required autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@theconts.com" style={input} />
              </div>
            )}

            {screen !== 'forgot' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <label htmlFor="pw" style={label}>{screen === 'change' ? 'NEW PASSWORD' : 'PASSWORD'}</label>
                  <button type="button" onClick={() => setShow(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: text.small, fontWeight: 500, color: color.textMuted, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                    <Icon name={show ? 'EyeOff' : 'Eye'} size="sm" />
                    <span>{show ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <input id="pw" type={show ? 'text' : 'password'} required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={screen === 'change' ? 'New password' : 'Enter password'} style={input} />
              </div>
            )}

            {screen === 'change' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 16, border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.page }}>
                {policy.map(p => (
                  <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: text.small }}>
                    <span style={{ width: 13, textAlign: 'center', color: p.ok ? '#11694A' : color.textMuted }}>{p.ok ? '\u2713' : '\u25CB'}</span>
                    <span style={{ color: p.ok ? color.ink : color.textMuted }}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}

            {screen === 'signin' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: text.small, color: color.textMuted }}>
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ accentColor: '#11694A', width: 16, height: 16 }} />
                  Keep me signed in
                </label>
                <button type="button" onClick={() => { setScreen('forgot'); setError(''); }}
                  style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          <button type="submit" disabled={busy}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', boxSizing: 'border-box', height: 50, borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: text.body, fontWeight: 500, border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, transition: `background ${motion.fast} ease-out` }}>
            {busy && <span className="animate-spin" style={{ width: 14, height: 14, borderRadius: radius.pill, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#FFFFFF' }} />}
            <span>{c.submit}</span>
          </button>

          {screen !== 'signin' && !forceChangePassword && (
            <button type="button" onClick={() => { setScreen('signin'); setError(''); setSent(false); }}
              style={{ alignSelf: 'center', fontSize: text.small, fontWeight: 500, color: color.textMuted, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
              Back to sign in
            </button>
          )}
        </form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', fontSize: text.micro, color: color.faint }}>
          <span>The Conts Sdn Bhd · 202301027399</span>
          <span>+60 17-465 8868</span>
        </div>
      </div>
    </div>
  );
}
