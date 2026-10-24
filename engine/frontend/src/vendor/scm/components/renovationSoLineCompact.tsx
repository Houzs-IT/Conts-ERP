/* Renovation mode (Conts, owner 24 Oct 2026): the pieces of the compact Sales Order line
   (SoLineCard with `compact`): the column header that sits once above a room's lines, and
   the small photo button whose pop-over holds the line's usual photo strip and upload. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, ImagePlus } from 'lucide-react';
import { anchoredPanelStyle, useFixedWidthPanel } from '../../../lib/anchoredPanel';
import styles from './renovationSoLineCompact.module.css';

export { styles as renovationLineStyles };

export function RenovationLineHead() {
  return (
    <div className={styles.head} aria-hidden="true">
      <span className={styles.center}>#</span>
      <span>Item</span>
      <span>Remarks</span>
      <span className={styles.right}>Qty</span>
      <span className={styles.right}>Unit price</span>
      <span className={styles.right}>Disc</span>
      <span>Date</span>
      <span className={styles.right}>Amount</span>
      <span className={styles.center}>Photos</span>
      <span />
    </div>
  );
}

const PANEL_W = 300;
const PANEL_MAX_H = 360;

export function RenovationPhotoButton({ count, disabled, title, children }: {
  count: number;
  disabled?: boolean;
  title?: string;
  /** The line's photo strip; rendered only while the pop-over is open. */
  children: ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number } | null>(null);
  const pos = useFixedWidthPanel(anchor, PANEL_W, PANEL_MAX_H);
  const open = anchor !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnchor(null); };
    document.addEventListener('mousedown', close);
    /* The pop-over is placed once, at the click; a scroll of the page would leave it behind. */
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${styles.photoBtn} ${count > 0 ? styles.photoBtnOn : ''}`}
        aria-label={count > 0 ? `Photos (${count})` : 'Add photos'}
        aria-expanded={open}
        title={title ?? (count > 0 ? `${count} photo${count === 1 ? '' : 's'}` : 'Add photos')}
        disabled={disabled}
        onClick={() => {
          if (open) { setAnchor(null); return; }
          const r = btn.current?.getBoundingClientRect();
          if (r) setAnchor({ top: r.top, bottom: r.bottom, left: r.right - PANEL_W });
        }}
      >
        {count > 0 ? <ImageIcon size={16} strokeWidth={1.75} /> : <ImagePlus size={16} strokeWidth={1.75} />}
        {count > 0 && <span className={styles.count}>{count}</span>}
      </button>
      {open && pos && createPortal(
        <div ref={panel} role="dialog" aria-label="Line photos" className={styles.popover}
          style={{ ...anchoredPanelStyle(pos), maxHeight: pos.maxHeight }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
