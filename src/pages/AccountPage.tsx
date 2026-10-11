import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import PageHeader from '../components/PageHeader';
import { Card, CardHeader } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { PasswordField } from '../components/Field';
import { CodeInput } from '../components/inputs';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { date, dateTime, plural } from '../lib/format';
import { SIGN_IN_METHOD, SIGN_IN_RESULT, deviceOf } from '../lib/signIns';

interface Account {
  twoStep: { enabled: boolean; enabledAt: string | null; backupCodesLeft: number; available: boolean; unavailableReason: string | null; requiredForRole: boolean };
  recentSignIns: { at: string; ip: string | null; userAgent: string | null; result: string; method: string }[];
  /** Browsers signed in now; null until the database has migration 0106. */
  devices: { id: string; since: string; ip: string | null; userAgent: string | null; current: boolean }[] | null;
}

/**
 * My account: the signed-in person's own password, two-step sign-in, recent sign-ins and other devices.
 * Every role reaches it (desk, field and owner shells); someone whose role requires two-step sign-in and
 * has not set it up sees only the two-step part (`gate`), because nothing else answers until it is on.
 */
export default function AccountPage({ gate = false }: { gate?: boolean }) {
  const { user, refresh, logout } = useSession();
  const { data, loading, reload } = useApi<Account>('/account');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  async function signOutOthers() {
    setBusy(true);
    try {
      await api.post('/account/sign-out-others');
      toast({ tone: 'success', title: 'Signed out of every other device.', body: 'This browser stays signed in.' });
      setConfirm(null);
      reload();
    } catch (err) {
      toast({ tone: 'critical', title: 'Other devices were not signed out.', body: errorMessage(err, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  async function signOutDevice(id: string) {
    setBusy(true);
    try {
      await api.post(`/account/sessions/${id}/end`);
      toast({ tone: 'success', title: 'That device is signed out.' });
      setConfirm(null);
      reload();
    } catch (err) {
      toast({ tone: 'critical', title: 'That device was not signed out.', body: errorMessage(err, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const twoStep = (
    <TwoStepCard data={data} loading={loading} gate={gate}
      onChanged={async () => { reload(); if (gate || user?.twoStepSetupRequired) await refresh(); }} />
  );

  if (gate) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Set up two-step sign-in" sub="Management requires it for your role. It takes about two minutes and you need your phone." />
        {twoStep}
        <div><Button variant="tertiary" size="md" onClick={logout}>Log out</Button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My account" sub={user ? `${user.fullName} · ${user.email}` : undefined} />
      {twoStep}
      <PasswordCard />
      {data?.devices && (
        <Card>
          <CardHeader title="Signed in now" />
          <div className="flex flex-col">
            {data.devices.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-2.5 [border-top:1px_solid_var(--color-line-soft)] flex-wrap">
                <span className="flex-1 min-w-[160px] flex flex-col gap-px">
                  <span className="text-copy">{deviceOf(d.userAgent)}</span>
                  <span className="text-caption text-muted-ink">Since {dateTime(d.since)}{d.ip ? ` · ${d.ip}` : ''}</span>
                </span>
                {d.current ? (
                  <>
                    <StatusBadge tone="success" label="This device" size="sm" />
                    <Button variant="tertiary" size="sm" onClick={logout}>Log out</Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setConfirm({
                    title: `Sign out ${deviceOf(d.userAgent)}?`,
                    body: 'That device is signed out on its next click and must sign in again. This browser stays signed in.',
                    confirmLabel: 'Sign out', busyLabel: 'Signing out…', danger: true,
                    onConfirm: () => signOutDevice(d.id),
                  })}>Sign out</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Recent sign-ins" right={
          <Button variant="secondary" size="sm" onClick={() => setConfirm({
            title: 'Sign out of every other device?',
            body: 'Every other phone and computer signed in as you is signed out now. This browser stays signed in. Use this if you signed in on a shared computer or lost a phone.',
            confirmLabel: 'Sign out other devices', busyLabel: 'Signing out…', danger: true,
            onConfirm: signOutOthers,
          })}>Sign out other devices</Button>
        } />
        {loading && !data ? <TableSkeleton rows={4} cols={3} /> : !data?.recentSignIns.length ? (
          <div className="px-5 pb-5 text-copy text-muted-ink">No sign-ins recorded yet. They appear here from your next sign-in.</div>
        ) : (
          <div className="flex flex-col">
            {data.recentSignIns.map((s, i) => {
              const r = SIGN_IN_RESULT[s.result] ?? { label: s.result, tone: 'neutral' as const };
              return (
                <div key={`${s.at}-${i}`} className="flex items-center gap-3 px-5 py-2.5 [border-top:1px_solid_var(--color-line-soft)] flex-wrap">
                  <span className="text-copy tabular-nums min-w-[150px]">{dateTime(s.at)}</span>
                  <span className="flex-1 min-w-[160px] flex flex-col gap-px">
                    <span className="text-copy">{deviceOf(s.userAgent)}</span>
                    <span className="text-caption text-muted-ink">{SIGN_IN_METHOD[s.method] ?? s.method}{s.ip ? ` · ${s.ip}` : ''}</span>
                  </span>
                  <StatusBadge tone={r.tone} label={r.label} size="sm" />
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </div>
  );
}

/* ------------------------------ two-step sign-in ------------------------------ */

function TwoStepCard({ data, loading, gate, onChanged }: { data: Account | null; loading: boolean; gate: boolean; onChanged: () => Promise<void> | void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [ask, setAsk] = useState<'disable' | 'replace' | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [busy, setBusy] = useState(false);
  const t = data?.twoStep;

  async function start() {
    setBusy(true);
    try { setSetup(await api.post<{ secret: string; uri: string }>('/account/2fa/setup')); setCode(''); setCodeError(''); }
    catch (err) { toast({ tone: 'critical', title: 'Two-step sign-in could not start.', body: errorMessage(err, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }
  async function confirmCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setCodeError('');
    try {
      const res = await api.post<{ backupCodes: string[] }>('/account/2fa/confirm', { code });
      setSetup(null); setCodes(res.backupCodes);
      await onChanged();
    } catch (err) { setCodeError(errorMessage(err, 'Try again.')); }
    finally { setBusy(false); }
  }
  async function withPassword(e: FormEvent) {
    e.preventDefault();
    if (busy || !ask) return;
    setBusy(true); setPasswordError('');
    try {
      if (ask === 'replace') {
        const res = await api.post<{ backupCodes: string[] }>('/account/2fa/backup-codes', { password });
        setCodes(res.backupCodes);
      } else {
        await api.post('/account/2fa/disable', { password });
        toast({ tone: 'success', title: 'Two-step sign-in is off.', body: 'You now sign in with your password alone.' });
      }
      setAsk(null); setPassword('');
      await onChanged();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields?.password) setPasswordError(err.fields.password);
      else toast({ tone: 'critical', title: 'Nothing changed.', body: errorMessage(err, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const status = !t ? null : t.enabled
    ? <StatusBadge tone="success" label={`On since ${date(t.enabledAt!)}`} size="sm" />
    : <StatusBadge tone={t.requiredForRole ? 'warning' : 'neutral'} label={t.requiredForRole ? 'Off, required for your role' : 'Off'} size="sm" />;

  return (
    <Card>
      <CardHeader title="Two-step sign-in" right={status} />
      <div className="px-5 pb-5 flex flex-col gap-4">
        <p className="m-0 text-copy text-muted-ink leading-[1.5] max-w-[640px]">
          After your password, you also enter a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and similar). Someone who learns your password still cannot sign in without your phone.
        </p>

        {loading && !t ? <TableSkeleton rows={2} cols={2} /> : !t ? null : codes ? (
          <BackupCodes codes={codes} onDone={() => setCodes(null)} />
        ) : setup ? (
          <form onSubmit={confirmCode} className="flex flex-col gap-4">
            <div className="flex gap-5 flex-wrap items-start">
              <QrCode text={setup.uri} />
              <ol className="m-0 pl-5 flex flex-col gap-2 text-copy leading-[1.5] flex-1 min-w-[220px] max-w-[440px]">
                <li>Open your authenticator app and add an account.</li>
                <li>Scan this code with the app. If you cannot scan, choose to enter a key and type:
                  <div className="mt-1.5 font-mono text-meta break-all select-all py-2 px-2.5 rounded-control bg-page border border-solid border-line">{setup.secret.match(/.{1,4}/g)!.join(' ')}</div>
                </li>
                <li>Enter the 6-digit code the app now shows for Conts ERP.</li>
              </ol>
            </div>
            <div className="max-w-[240px]">
              <CodeInput value={code} required onChange={setCode} error={codeError} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button type="submit" variant="primary" size="sm" loading={busy} disabled={code.length !== 6}>Turn on two-step sign-in</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSetup(null)} disabled={busy}>Cancel</Button>
            </div>
          </form>
        ) : ask ? (
          <form onSubmit={withPassword} className="flex flex-col gap-3 max-w-[360px]">
            <span className="text-copy">{ask === 'disable' ? 'Enter your password to turn two-step sign-in off.' : 'Enter your password to get ten new backup codes. The old ones stop working.'}</span>
            <PasswordField label="Password" value={password} required autoComplete="current-password" onChange={e => setPassword(e.target.value)} error={passwordError} />
            <div className="flex gap-2 flex-wrap">
              <Button type="submit" variant={ask === 'disable' ? 'danger' : 'primary'} size="sm" loading={busy}>{ask === 'disable' ? 'Turn off' : 'Get new backup codes'}</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => { setAsk(null); setPassword(''); setPasswordError(''); }} disabled={busy}>Cancel</Button>
            </div>
          </form>
        ) : !t.available ? (
          <Note tone="warning">{t.unavailableReason}</Note>
        ) : t.enabled ? (
          <div className="flex flex-col gap-3">
            <span className="text-copy">{plural(t.backupCodesLeft, 'backup code')} left.{t.backupCodesLeft <= 3 ? ' Get new ones before you run out.' : ''}</span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => setAsk('replace')}>Get new backup codes</Button>
              {!t.requiredForRole && <Button variant="secondary" size="sm" onClick={() => setAsk('disable')}>Turn off</Button>}
            </div>
            {t.requiredForRole && <span className="text-meta text-muted-ink">Your role must use two-step sign-in. Moving to a new phone: ask management to reset it, then set it up again.</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {gate && <Note tone="info">Until this is set up, the rest of the system stays closed for your account.</Note>}
            <div><Button variant="primary" size="sm" loading={busy} onClick={start}>Set up two-step sign-in</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const text = `Conts ERP backup codes (each works once)\n\n${codes.join('\n')}\n`;
  return (
    <div className="flex flex-col gap-3">
      <Note tone="success">Two-step sign-in is on. Save these ten backup codes somewhere safe, away from your phone. Each one signs you in once if you lose your phone. They are shown only now.</Note>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 py-3 px-4 rounded-control bg-page border border-solid border-line max-w-[360px] font-mono text-copy select-all">
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(text).then(
          () => toast({ tone: 'success', title: 'Backup codes copied.' }),
          () => toast({ tone: 'warning', title: 'Could not copy. Select the codes and copy them by hand.' }))}>Copy codes</Button>
        <Button variant="secondary" size="sm" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
          a.download = 'conts-erp-backup-codes.txt'; a.click(); URL.revokeObjectURL(a.href);
        }}>Download as a file</Button>
        <Button variant="primary" size="sm" onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

/** The otpauth:// address as a QR code, drawn here: the secret never leaves the browser for an image service. */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg role="img" aria-label="QR code to scan with your authenticator app" viewBox={`0 0 ${size} ${size}`} width={184} height={184}
      shapeRendering="crispEdges" className="flex-none rounded-control border border-solid border-line bg-white">
      <path d={path} fill="var(--color-brand-black)" />
    </svg>
  );
}

const NOTE_TONE = {
  info: '[border-left:2px_solid_var(--color-info-line)] bg-info-bg text-info',
  warning: '[border-left:2px_solid_var(--color-warning-line)] bg-warning-bg text-warning',
  success: '[border-left:2px_solid_var(--color-success-line)] bg-success-bg text-success',
};
function Note({ tone, children }: { tone: keyof typeof NOTE_TONE; children: ReactNode }) {
  return <div className={`py-3 px-3.5 text-meta leading-[1.5] ${NOTE_TONE[tone]}`}>{children}</div>;
}

/* --------------------------------- password --------------------------------- */

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const policy = [
    { label: 'At least 8 characters', ok: next.length >= 8 },
    { label: 'At least 1 uppercase letter', ok: /[A-Z]/.test(next) },
    { label: 'At least 1 digit', ok: /[0-9]/.test(next) },
  ];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErrors({});
    try {
      await api.post('/account/password', { current, password: next });
      toast({ tone: 'success', title: 'Password changed.', body: 'Use the new one next time you sign in.' });
      setCurrent(''); setNext('');
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      else toast({ tone: 'critical', title: 'Password not changed.', body: errorMessage(err, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title="Password" />
      <form onSubmit={submit} className="px-5 pb-5 flex flex-col gap-4 max-w-[360px]">
        <PasswordField label="Current password" value={current} required autoComplete="current-password" onChange={e => setCurrent(e.target.value)} error={errors.current} />
        <PasswordField label="New password" value={next} required autoComplete="new-password" onChange={e => setNext(e.target.value)} error={errors.password} />
        <div className="flex flex-col gap-1.5">
          {policy.map(p => (
            <span key={p.label} className={`text-meta ${p.ok ? 'text-success' : 'text-muted-ink'}`}>{p.ok ? '✓' : '○'} {p.label}</span>
          ))}
        </div>
        <div><Button type="submit" variant="primary" size="sm" loading={busy} disabled={!policy.every(p => p.ok) || !current}>Change password</Button></div>
      </form>
    </Card>
  );
}
