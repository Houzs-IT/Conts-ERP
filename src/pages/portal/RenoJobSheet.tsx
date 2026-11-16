import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { color, radius, text, tone } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import { MAX_PROOF_PHOTOS, clampDoneCount, formatCount, parseCount, shrinkPhoto, type RenoLine } from '../../lib/renoJobs';

export interface RenoJobSheetProps {
  line: RenoLine;
  isSaving: boolean;
  errorText: string | null;
  onCancel: () => void;
  onSave: (doneQty: number, photos: File[]) => void;
}

interface ProofPhoto {
  id: string;
  file: File;
  url: string;
}

interface ViewportBox {
  top: number;
  height: number | null;
}

const COUNTER_BUTTON: CSSProperties = {
  width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control,
  border: `1px solid ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0,
};

const QUICK_BUTTON: CSSProperties = {
  flex: 1, minHeight: 44, borderRadius: radius.control, border: `1px solid ${color.borderStrong}`, background: color.card,
  color: color.ink, fontSize: text.heading, fontWeight: 600, cursor: 'pointer', padding: '0 12px',
};

const PHOTO_TILE: CSSProperties = {
  width: 64, height: 64, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.control,
  border: `1px dashed ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0, fontSize: text.meta, fontWeight: 600, boxSizing: 'border-box',
};

function useViewportBox(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ top: 0, height: null });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const sync = (): void => setBox({ top: viewport.offsetTop, height: viewport.height });
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, []);
  return box;
}

function useLockedPageScroll(): void {
  useEffect(() => {
    const { body, documentElement } = document;
    const previousBody = body.style.overflow;
    const previousRoot = documentElement.style.overflow;
    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousBody;
      documentElement.style.overflow = previousRoot;
    };
  }, []);
}

export default function RenoJobSheet({ line, isSaving, errorText, onCancel, onSave }: RenoJobSheetProps) {
  const t = usePortalText().renoJobs;
  const { qty, doneQty, isTradeClosed } = line;
  const floor = isTradeClosed ? doneQty : 0;
  const [raw, setRaw] = useState(formatCount(doneQty));
  const [photos, setPhotos] = useState<ProofPhoto[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const photosRef = useRef<ProofPhoto[]>([]);
  const box = useViewportBox();
  useLockedPageScroll();
  const parsed = parseCount(raw);
  const count = parsed === null ? null : Math.max(floor, clampDoneCount(parsed, qty));
  const shownCount = count ?? doneQty;
  const label = line.remark?.trim() || line.name;
  const isBusy = isSaving || isPreparing;
  const isFull = photos.length >= MAX_PROOF_PHOTOS;
  const progress = t.ofText(formatCount(shownCount), formatCount(qty));

  const setCount = (next: number): void => setRaw(formatCount(Math.max(floor, clampDoneCount(next, qty))));

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !isSaving) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSaving, onCancel]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => { photosRef.current.forEach(photo => URL.revokeObjectURL(photo.url)); }, []);

  const addPhotos = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target;
    const chosen = [...(input.files ?? [])].filter(file => file.type.startsWith('image/') || file.type === '').slice(0, MAX_PROOF_PHOTOS - photos.length);
    input.value = '';
    if (chosen.length === 0) return;
    setIsPreparing(true);
    try {
      const shrunk = await Promise.all(chosen.map(shrinkPhoto));
      const added = shrunk.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
      setPhotos(current => [...current, ...added].slice(0, MAX_PROOF_PHOTOS));
    } finally {
      setIsPreparing(false);
    }
  };

  const removePhoto = (id: string): void => {
    const gone = photos.find(photo => photo.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    setPhotos(current => current.filter(photo => photo.id !== id));
  };

  const canSave = count !== null && photos.length > 0 && !isBusy;

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, top: box.top, height: box.height ?? '100dvh', zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div aria-hidden onClick={isSaving ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'var(--color-surface-scrim)' }} />
      <div role="dialog" aria-modal="true" aria-label={t.updateLine(label)}
        style={{
          position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box', maxHeight: '100%', display: 'flex', flexDirection: 'column', minHeight: 0,
          background: color.card, borderRadius: `${radius.dialog}px ${radius.dialog}px 0 0`, boxShadow: 'var(--shadow-overlay)',
        }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink }}>{t.proof}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {photos.map((photo, index) => (
                <div key={photo.id} style={{ width: 64, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <img src={photo.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: radius.control, display: 'block' }} />
                  <button type="button" aria-label={t.removePhoto(index + 1)} disabled={isSaving} onClick={() => removePhoto(photo.id)}
                    style={{ width: 64, height: 44, display: 'grid', placeItems: 'center', borderRadius: radius.control, border: `1px solid ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0 }}>
                    <Icon name="X" size="nav" />
                  </button>
                </div>
              ))}
              {!isFull && (
                <>
                  <label style={{ ...PHOTO_TILE, opacity: isBusy ? 0.5 : 1 }}>
                    <Icon name="Camera" size="nav" />
                    <span>{t.takePhoto}</span>
                    <input type="file" accept="image/*" capture="environment" multiple disabled={isBusy} onChange={event => void addPhotos(event)} style={{ display: 'none' }} />
                  </label>
                  <label style={{ ...PHOTO_TILE, opacity: isBusy ? 0.5 : 1 }}>
                    <Icon name="Images" size="nav" />
                    <span>{t.fromGallery}</span>
                    <input type="file" accept="image/*" multiple disabled={isBusy} onChange={event => void addPhotos(event)} style={{ display: 'none' }} />
                  </label>
                </>
              )}
            </div>
            <span style={{ fontSize: text.copy, color: color.textMuted }}>
              {isPreparing ? t.preparing : isFull ? t.maxPhotos(MAX_PROOF_PHOTOS) : photos.length === 0 ? t.proofHint : t.photos(photos.length)}
            </span>
          </div>

          {isTradeClosed && <span role="note" style={{ fontSize: text.copy, color: color.textMuted }}>{t.tradeClosed}</span>}
          {errorText && (
            <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg, background: tone.critical.bg, borderRadius: radius.control, padding: '10px 12px' }}>{errorText}</span>
          )}
          {isSaving && <span role="status" style={{ fontSize: text.copy, color: color.textMuted }}>{t.saving}</span>}
        </div>

        <div style={{ flex: 'none', display: 'flex', gap: 10, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${color.border}` }}>
          <Button variant="secondary" size="touch" disabled={isSaving} onClick={onCancel} style={{ flex: 1 }}>{t.cancel}</Button>
          <Button variant="primary" size="touch" loading={isSaving} disabled={!canSave} onClick={() => { if (count !== null) onSave(count, photos.map(photo => photo.file)); }} style={{ flex: 2 }}>
            {photos.length > 0 ? t.save(progress, photos.length) : t.saveNoPhoto(progress)}
          </Button>
        </div>
      </div>
    </div>
  );
}
