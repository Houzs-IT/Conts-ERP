import { type ReactNode } from 'react';
import { Drawer } from './Dialog';
import { useMedia } from '../lib/useMedia';
import { cx } from '../lib/design-tokens';

/**
 * A list with a detail panel beside it. On a wide screen both panes fill the height left under the page header and
 * scroll on their own, so the list never "stops" while the page scrolls and the panel stays in view. Below 1024px
 * the list scrolls with the page and the detail opens as a drawer over it (full width on a phone).
 * The page that uses it must be a flex column that fills the content area (`flex-1 min-h-0`).
 */
export default function SplitPane({ list, detail, empty, open, onClose, width = 420 }: {
  list: ReactNode;
  /** The detail panel's content, or null when nothing is selected. */
  detail: ReactNode | null;
  /** What the panel shows when nothing is selected (wide screens only). */
  empty?: ReactNode;
  open: boolean;
  onClose: () => void;
  width?: number;
}) {
  const wide = useMedia('(min-width: 1024px)');
  if (!wide) {
    return (
      <>
        <div className="flex flex-col gap-3.5 min-w-0">{list}</div>
        <Drawer open={open && !!detail} onClose={onClose} width={width + 40}>{detail}</Drawer>
      </>
    );
  }
  return (
    <div className="flex gap-[18px] flex-1 min-h-[440px]">
      <div className="ops-scroll flex-1 min-w-0 overflow-y-auto overscroll-contain flex flex-col gap-3.5 pr-1 -mr-1">{list}</div>
      <aside style={{ width }} className={cx('ops-scroll flex-none overflow-y-auto overscroll-contain bg-card rounded-card border border-solid border-line',
        !detail && 'grid place-items-center')}>
        {detail ?? empty}
      </aside>
    </div>
  );
}
