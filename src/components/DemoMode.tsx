import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { color, radius } from '../theme';
import { useToast } from './Toast';
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog';
import Icon from './Icon';

/** Demo mode (Owner Hub plan, owner, 2 Nov 2026): the browser's own switch, for management and sales staff. The server
 *  checks the person on every request (functions/_lib/demo.ts). Switching reloads the page, so every screen reads
 *  from the right place at once. */
async function setDemo(on: boolean) {
  await api.post('/demo', { on });
  window.location.reload();
}

/** The top bar's switch, beside light and dark. Shown only to people who may use Demo mode. */
export function DemoButton({ size, iconOnly = false }: { size: number; iconOnly?: boolean }) {
  const { user } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user?.demo?.allowed) return null;
  const on = user.demo.on;
  const label = on ? 'Turn Demo mode off' : 'Turn Demo mode on';
  const flip = async () => {
    setBusy(true);
    try { await setDemo(!on); } catch (e) { setBusy(false); toast({ tone: 'critical', title: 'Demo mode did not switch.', body: errorMessage(e, 'Try again in a moment.') }); }
  };
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} disabled={busy} onClick={() => void flip()}
      style={{
        height: size, minWidth: size, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: iconOnly ? 0 : '0 10px', borderRadius: radius.control, cursor: 'pointer',
        border: `1px solid ${on ? 'var(--color-info-line)' : color.border}`, background: on ? DEMO_BG : color.card, color: on ? 'white' : color.ink,
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
      }}>
      <Icon name="FlaskConical" size="sm" />
      {!iconOnly && <span>Demo</span>}
    </button>
  );
}

/** The band across the top while Demo mode is on, with Clear demo and Turn off. */
export function DemoBand() {
  const { user } = useSession();
  const toast = useToast();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user?.demo?.on) return null;
  const clear = async () => {
    setBusy(true);
    try {
      await api.del('/demo');
      window.location.reload();
    } catch (e) {
      setBusy(false); setConfirm(null);
      toast({ tone: 'critical', title: 'Demo data was not cleared.', body: errorMessage(e, 'Try again in a moment.') });
    }
  };
  const btn = { border: '1px solid rgba(255,255,255,0.45)', background: 'transparent', color: 'white', borderRadius: radius.control, padding: '3px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' } as const;
  return (
    <div role="status" data-demo-band style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 16px', background: DEMO_BG, color: 'white', fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>
      <Icon name="FlaskConical" size="sm" />
      <span style={{ flex: '1 1 220px', minWidth: 0 }}><b>Demo mode</b> · sample data mixed with real data. Nothing here reaches owners or channels.</span>
      <span data-print-hide style={{ display: 'inline-flex', gap: 8 }}>
        <button type="button" style={btn} onClick={() => setConfirm({
          title: 'Clear all demo data?',
          body: 'Every sample reservation, review, unit and owner goes, and every change made to a real record in Demo mode is undone. Real records are not touched.',
          confirmLabel: 'Clear demo', busyLabel: 'Clearing…', danger: true, onConfirm: () => void clear(),
        })}>Clear demo</button>
        <button type="button" style={btn} onClick={() => void setDemo(false)}>Turn off</button>
      </span>
      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** The plan's blue, deepened a little so white text reads on it in light and dark. */
export const DEMO_BG = 'color-mix(in srgb, var(--color-info-line) 82%, black)';

/** The small "Sample" mark on a row or record that is demo data ('demo') or a real record changed in Demo mode ('shadow'). */
export function SampleMark({ kind }: { kind?: 'demo' | 'shadow' }) {
  if (!kind) return null;
  return (
    <span title={kind === 'demo' ? 'Sample data, Demo mode only' : 'Changed in Demo mode only; the real record is unchanged'}
      style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', borderRadius: radius.pill, border: '1px solid var(--color-info-line)', color: 'var(--color-info-line)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' }}>
      {kind === 'demo' ? 'Sample' : 'Edited in demo'}
    </span>
  );
}
