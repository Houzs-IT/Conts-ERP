import { useState, type CSSProperties } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { color, radius, text, tone } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import { clampDoneCount, formatCount, parseCount, type RenoLine } from '../../lib/renoJobs';
import ProofPhotoPicker, { useProofPhotos } from './ProofPhotoPicker';
import SheetFrame from './SheetFrame';

export interface RenoJobSheetProps {
  line: RenoLine;
  isSaving: boolean;
  errorText: string | null;
  onCancel: () => void;
  onSave: (doneQty: number, photos: File[]) => void;
}

const COUNTER_BUTTON: CSSProperties = {
  width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control,
  border: `1px solid ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0,
};

const QUICK_BUTTON: CSSProperties = {
  flex: 1, minHeight: 44, borderRadius: radius.control, border: `1px solid ${color.borderStrong}`, background: color.card,
  color: color.ink, fontSize: text.heading, fontWeight: 600, cursor: 'pointer', padding: '0 12px',
};

export default function RenoJobSheet({ line, isSaving, errorText, onCancel, onSave }: RenoJobSheetProps) {
  const t = usePortalText().renoJobs;
  const { qty, doneQty, isTradeClosed } = line;
  const floor = isTradeClosed ? doneQty : 0;
  const [raw, setRaw] = useState(formatCount(doneQty));
  const proofPhotos = useProofPhotos();
  const { photos, isPreparing } = proofPhotos;
  const parsed = parseCount(raw);
  const count = parsed === null ? null : Math.max(floor, clampDoneCount(parsed, qty));
  const shownCount = count ?? doneQty;
  const label = line.remark?.trim() || line.name;
  const isBusy = isSaving || isPreparing;
  const progress = t.ofText(formatCount(shownCount), formatCount(qty));

  const setCount = (next: number): void => setRaw(formatCount(Math.max(floor, clampDoneCount(next, qty))));

  const canSave = count !== null && photos.length > 0 && !isBusy;

  const body = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: text.title, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{label}</span>
        <span style={{ fontSize: text.copy, color: color.textMuted }}>
          {line.room?.trim() || t.noRoom} · {t.qty(formatCount(qty), line.uom)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" aria-label={t.oneLess} disabled={isSaving || shownCount <= floor} onClick={() => setCount(shownCount - 1)}
          style={{ ...COUNTER_BUTTON, opacity: shownCount <= floor ? 0.4 : 1 }}>
          <Icon name="Minus" size="nav" />
        </button>
        <input aria-label={t.unitsAria(formatCount(qty))} inputMode="decimal" value={raw} disabled={isSaving}
          onChange={event => setRaw(event.target.value)} onBlur={() => { if (parsed !== null) setCount(parsed); }} onFocus={event => event.target.select()}
          style={{
            flex: 1, minWidth: 0, height: 48, boxSizing: 'border-box', textAlign: 'center', fontSize: text.title, fontWeight: 700, color: color.ink,
            background: color.card, border: `1px solid ${count === null ? tone.critical.line : color.borderStrong}`, borderRadius: radius.control,
          }} />
        <button type="button" aria-label={t.oneMore} disabled={isSaving || shownCount >= qty} onClick={() => setCount(shownCount + 1)}
          style={{ ...COUNTER_BUTTON, opacity: shownCount >= qty ? 0.4 : 1 }}>
          <Icon name="Plus" size="nav" />
        </button>
      </div>
      <span style={{ fontSize: text.copy, color: color.textMuted, textAlign: 'center', marginTop: -6 }}>{t.unitsDone(formatCount(qty), line.uom)}</span>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" disabled={isSaving} onClick={() => setCount(qty)} style={QUICK_BUTTON}>{t.allOf(formatCount(qty))}</button>
        <button type="button" disabled={isSaving || floor > 0} onClick={() => setCount(0)} style={{ ...QUICK_BUTTON, opacity: floor > 0 ? 0.4 : 1 }}>{t.none}</button>
      </div>

      <ProofPhotoPicker proofPhotos={proofPhotos} heading={t.proof} hint={t.proofHint} isSaving={isSaving} />

      {isTradeClosed && <span role="note" style={{ fontSize: text.copy, color: color.textMuted }}>{t.tradeClosed}</span>}
      {errorText && (
        <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg, background: tone.critical.bg, borderRadius: radius.control, padding: '10px 12px' }}>{errorText}</span>
      )}
      {isSaving && <span role="status" style={{ fontSize: text.copy, color: color.textMuted }}>{t.saving}</span>}
    </>
  );

  const footer = (
    <>
      <Button variant="secondary" size="touch" disabled={isSaving} onClick={onCancel} style={{ flex: 1 }}>{t.cancel}</Button>
      <Button variant="primary" size="touch" loading={isSaving} disabled={!canSave} onClick={() => { if (count !== null) onSave(count, photos.map(photo => photo.file)); }} style={{ flex: 2 }}>
        {photos.length > 0 ? t.save(progress, photos.length) : t.saveNoPhoto(progress)}
      </Button>
    </>
  );

  return <SheetFrame label={t.updateLine(label)} isSaving={isSaving} onCancel={onCancel} body={body} footer={footer} />;
}
