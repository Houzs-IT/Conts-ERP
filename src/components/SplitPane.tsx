import { type ReactNode } from 'react';
import { Drawer } from './Dialog';
import { useMedia } from '../lib/useMedia';

/**
 * A list with a quick-view detail. The list always keeps the full width; opening a row slides the detail in as a drawer
 * over the right of the screen (full width on a phone), like the sales order quick view. A panel beside the list
 * squeezed it into narrow cards that were hard to read.
 * On a wide screen the list scrolls on its own, so the page that uses it must be a flex column that fills the content
 * area (`flex-1 min-h-0`); below 1024px it scrolls with the page.
 */
export default function SplitPane(props: {
  list: ReactNode;
  /** The detail panel's content, or null when nothing is selected. */
  detail: ReactNode | null;
  open: boolean;
  onClose: () => void;
  width?: number;
}) {
  const { list, detail, open, onClose } = props;
  const width = props.width ?? 420;
  const wide = useMedia('(min-width: 1024px)');
  const xwide = useMedia('(min-width: 1440px)');
  return (
    <>
      {wide
        ? <div className="ops-scroll flex-1 min-h-[440px] min-w-0 overflow-y-auto overflow-x-auto overscroll-contain flex flex-col gap-3.5 pr-1 -mr-1">{list}</div>
        : <div className="flex flex-col gap-3.5 min-w-0">{list}</div>}
      <Drawer open={open && !!detail} onClose={onClose} width={xwide ? width + 60 : width + 40}>{detail}</Drawer>
    </>
  );
}
