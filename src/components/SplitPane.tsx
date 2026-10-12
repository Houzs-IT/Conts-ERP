import { type ReactNode } from 'react';
import { Drawer } from './Dialog';
import { useMedia } from '../lib/useMedia';

/**
 * A list with a detail panel beside it. On a wide screen the list fills the full width until a row is opened; then the
 * detail slides in on the right (like a quick view) and both panes scroll on their own. Below 1024px the list scrolls
 * with the page and the detail opens as a drawer over it (full width on a phone).
 * `empty` is kept for callers but no longer shown: an empty panel only took width from the list.
 * The page that uses it must be a flex column that fills the content area (`flex-1 min-h-0`).
 */
export default function SplitPane(props: {
  list: ReactNode;
  /** The detail panel's content, or null when nothing is selected. */
  detail: ReactNode | null;
  /** Kept for compatibility; not rendered. */
  empty?: ReactNode;
  open: boolean;
  onClose: () => void;
  width?: number;
}) {
  const { list, detail, open, onClose } = props;
  const width = props.width ?? 420;
  const wide = useMedia('(min-width: 1024px)');
  const xwide = useMedia('(min-width: 1440px)');
  if (!wide) {
    return (
      <>
        <div className="flex flex-col gap-3.5 min-w-0">{list}</div>
        <Drawer open={open && !!detail} onClose={onClose} width={width + 40}>{detail}</Drawer>
      </>
    );
  }
  const show = open && !!detail;
  return (
    <div className="flex gap-[18px] flex-1 min-h-[440px]">
      <div className="ops-scroll flex-1 min-w-0 overflow-y-auto overflow-x-auto overscroll-contain flex flex-col gap-3.5 pr-1 -mr-1">{list}</div>
      {show && (
        <aside style={{ width: xwide ? width + 60 : Math.min(width, 380), animation: 'split-in 220ms cubic-bezier(.2,.7,.2,1) both' }}
          className="ops-scroll flex-none overflow-y-auto overscroll-contain bg-card rounded-card border border-solid border-line shadow-[var(--shadow-raised)]">
          {detail}
        </aside>
      )}
    </div>
  );
}
