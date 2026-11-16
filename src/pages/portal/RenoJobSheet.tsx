import { useEffect, useState, type CSSProperties } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { color, radius, text, tone } from '../../theme';
import { clampDoneCount, doneText, formatCount, type RenoLine } from '../../lib/renoJobs';

export interface RenoJobSheetProps {
  line: RenoLine;
  isSaving: boolean;
  errorText: string | null;
  onCancel: () => void;
  onSave: (doneQty: number) => void;
}

const COUNTER_BUTTON: CSSProperties = {
  width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control,
  border: `1px solid ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0,
};

const QUICK_BUTTON: CSSProperties = {
  flex: 1, minHeight: 44, borderRadius: radius.control, border: `1px solid ${color.borderStrong}`, background: color.card,
  color: color.ink, fontSize: text.heading, fontWeight: 600, cursor: 'pointer', padding: '0 12px',
};

export function parseCount(raw: string): number {
  const value = Number(raw.trim().replace(',', '.'));
  return raw.trim() === '' ? 0 : value;
}

export default function RenoJobSheet({ line, isSaving, errorText, onCancel, onSave }: RenoJobSheetProps) {
  const { qty, doneQty, isTradeClosed } = line;
  const floor = isTradeClosed ? doneQty : 0;
  const [raw, setRaw] = useState(formatCount(doneQty));
  const count = Math.max(floor, clampDoneCount(parseCount(raw), qty));
  const label = line.remark?.trim() || line.name;

  const setCount = (next: number): void => setRaw(formatCount(Math.max(floor, clampDoneCount(next, qty))));

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !isSaving) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSaving, onCancel]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div aria-hidden onClick={isSaving ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'var(--color-surface-scrim)' }} />
      <div role="dialog" aria-modal="true" aria-label={`Update ${label}`}
        style={{
          position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box', maxHeight: '92dvh', overflowY: 'auto',
          background: color.card, borderRadius: `${radius.dialog}px ${radius.dialog}px 0 0`, boxShadow: 'var(--shadow-overlay)',
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14,
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: text.title, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{label}</span>
          <span style={{ fontSize: text.copy, color: color.textMuted }}>
            {line.room?.trim() || 'No room'} · Qty {formatCount(qty)} {line.uom}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" aria-label="One less" disabled={isSaving || count <= floor} onClick={() => setCount(count - 1)}
            style={{ ...COUNTER_BUTTON, opacity: count <= floor ? 0.4 : 1 }}>
            <Icon name="Minus" size="nav" />
          </button>
          <input aria-label={`Units done out of ${formatCount(qty)}`} inputMode="decimal" value={raw} disabled={isSaving}
            onChange={event => setRaw(event.target.value)} onBlur={() => setCount(parseCount(raw))} onFocus={event => event.target.select()}
            style={{
              flex: 1, minWidth: 0, height: 48, boxSizing: 'border-box', textAlign: 'center', fontSize: text.title, fontWeight: 700, color: color.ink,
              background: color.card, border: `1px solid ${color.borderStrong}`, borderRadius: radius.control,
            }} />
          <button type="button" aria-label="One more" disabled={isSaving || count >= qty} onClick={() => setCount(count + 1)}
            style={{ ...COUNTER_BUTTON, opacity: count >= qty ? 0.4 : 1 }}>
            <Icon name="Plus" size="nav" />
          </button>
        </div>
        <span style={{ fontSize: text.copy, color: color.textMuted, textAlign: 'center', marginTop: -6 }}>of {formatCount(qty)} {line.uom} done</span>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" disabled={isSaving} onClick={() => setCount(qty)} style={QUICK_BUTTON}>All {formatCount(qty)} done</button>
          <button type="button" disabled={isSaving || floor > 0} onClick={() => setCount(0)} style={{ ...QUICK_BUTTON, opacity: floor > 0 ? 0.4 : 1 }}>None</button>
        </div>

        {isTradeClosed && (
          <span role="note" style={{ fontSize: text.copy, color: color.textMuted }}>This trade is closed. The office can reopen it.</span>
        )}
        {errorText && (
          <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg, background: tone.critical.bg, borderRadius: radius.control, padding: '10px 12px' }}>{errorText}</span>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="secondary" size="touch" disabled={isSaving} onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
          <Button variant="primary" size="touch" loading={isSaving} disabled={count === doneQty} onClick={() => onSave(count)} style={{ flex: 2 }}>
            Save {doneText(count, qty)}
          </Button>
        </div>
      </div>
    </div>
  );
}
