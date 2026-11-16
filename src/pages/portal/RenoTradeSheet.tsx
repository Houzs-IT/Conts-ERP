import { Button } from '../../components/Button';
import { color, radius, text, tone } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import { formatCount, linesToFinish, type RenoLine } from '../../lib/renoJobs';
import ProofPhotoPicker, { useProofPhotos } from './ProofPhotoPicker';
import SheetFrame from './SheetFrame';

export type RenoTradeMode = 'start' | 'finish';

export interface RenoTradeSheetProps {
  mode: RenoTradeMode;
  label: string;
  lines: RenoLine[];
  isSaving: boolean;
  errorText: string | null;
  onCancel: () => void;
  onSubmit: (photos: File[]) => void;
}

export default function RenoTradeSheet({ mode, label, lines, isSaving, errorText, onCancel, onSubmit }: RenoTradeSheetProps) {
  const t = usePortalText().renoJobs;
  const proofPhotos = useProofPhotos();
  const { photos, isPreparing } = proofPhotos;
  const isFinish = mode === 'finish';
  const open = isFinish ? linesToFinish(lines) : [];
  const canSubmit = photos.length > 0 && !isSaving && !isPreparing;

  const body = (
    <>
      <span style={{ fontSize: text.title, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{label}</span>

      {isFinish && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: text.copy, color: color.textMuted }}>{open.length > 0 ? t.finishListTitle : t.finishNoLines}</span>
          {open.map(line => (
            <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, minHeight: 44, borderBottom: `1px solid ${color.border}` }}>
              <span style={{ minWidth: 0, fontSize: text.copy, color: color.ink, overflowWrap: 'anywhere' }}>{line.room?.trim() ? `${line.room.trim()} · ` : ''}{line.remark?.trim() || line.name}</span>
              <span style={{ flex: 'none', fontSize: text.copy, fontWeight: 600, color: color.textMuted }}>{t.ofText(formatCount(line.doneQty), formatCount(line.qty))}</span>
            </div>
          ))}
        </div>
      )}

      <ProofPhotoPicker proofPhotos={proofPhotos} heading={isFinish ? t.afterPhotos : t.beforePhotos} hint={isFinish ? t.afterHint : t.beforeHint} isSaving={isSaving} />

      {errorText && (
        <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg, background: tone.critical.bg, borderRadius: radius.control, padding: '10px 12px' }}>{errorText}</span>
      )}
      {isSaving && <span role="status" style={{ fontSize: text.copy, color: color.textMuted }}>{t.saving}</span>}
    </>
  );

  const footer = (
    <>
      <Button variant="secondary" size="touch" disabled={isSaving} onClick={onCancel} style={{ flex: 1 }}>{t.cancel}</Button>
      <Button variant="primary" size="touch" loading={isSaving} disabled={!canSubmit} disabledReason={t.proofHint} onClick={() => onSubmit(photos.map(photo => photo.file))} style={{ flex: 2 }}>
        {isFinish ? t.finish : t.startWork}
      </Button>
    </>
  );

  return <SheetFrame label={isFinish ? t.finishSheet(label) : t.startSheet(label)} isSaving={isSaving} onCancel={onCancel} body={body} footer={footer} />;
}
