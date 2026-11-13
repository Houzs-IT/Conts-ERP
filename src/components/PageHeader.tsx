import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { color, text } from '../theme';
import Icon from './Icon';
import { Button, ButtonLink } from './Button';
import { useMarkPagePrimary, usePagePath } from './States';
import { findNav } from '../lib/navigation';
import { useMedia } from '../lib/useMedia';
import { time } from '../lib/format';
import { retrySnapshots, snapshotState, useSnapshotView } from '../lib/snapshotView';

/**
 * Title, a one-line subtitle (count and period, no developer notes), and the actions at the top right.
 * Put secondary actions in `actions` and the one primary action last in `primary`, so every page reads
 * the same way: [secondary] [secondary] [Primary]. `right` is kept for pages that build their own row.
 * `back` adds a small "‹ All owners" link above the title for record pages.
 *
 * Conts DS v2 (Nov 2026): a gold eyebrow sits above the title. It is the menu group of the current screen, read
 * from the navigation, unless the page passes its own `eyebrow` (or `eyebrow={false}` for none). Below 900px the
 * secondary buttons in `actions` fold into one "More" menu beside the primary button (HeaderActions).
 */
export default function PageHeader({ title, sub, right, actions, primary, back, badge, eyebrow }: {
  title: string; sub?: ReactNode; right?: ReactNode;
  actions?: ReactNode; primary?: ReactNode;
  back?: { label: string; onClick: () => void };
  badge?: ReactNode;
  /** The small gold label above the title. Defaults to the screen's menu group; false hides it. */
  eyebrow?: string | false;
}) {
  const hasActions = !!(actions || primary || right);
  useMarkPagePrimary(!!primary);
  const path = usePagePath();
  const brow = eyebrow === false ? null : eyebrow ?? (path ? eyebrowFor(path, title) : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      {back && (
        <button type="button" onClick={back.onClick} data-print-hide
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: text.copy, color: color.textMuted }}>
          <Icon name="ChevronLeft" size="sm" /> {back.label}
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 260px' }}>
          {brow && <span className="ds-eyebrow">{brow}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <h1 className="m-0 text-headline leading-[32px] font-bold tracking-[-0.015em] [text-wrap:balance] [overflow-wrap:anywhere]">{title}</h1>
            {badge}
            <SnapshotNote />
          </div>
          {/* Each "·" fact wraps as a unit on a phone, so "RM 0" or "awaiting owner approval" never splits across lines. */}
          {sub && <div className="max-sm:line-clamp-2" style={{ fontSize: text.copy, color: color.inkSecondary }}>
            {typeof sub === 'string'
              ? sub.split(' · ').map((part, n) => <span key={n}>{n > 0 && ' · '}<span className="inline-block">{part}</span></span>)
              : sub}
          </div>}
        </div>
        {hasActions && (
          // Right-aligned beside the title; once wrapped under it on a phone, left-aligned with it, not a ragged right stack.
          <div data-print-hide className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
            <HeaderActions actions={actions} primary={primary}>{right}</HeaderActions>
          </div>
        )}
      </div>
    </div>
  );
}

/** Snapshots older than this say how old they are (Houzs 49e80ffd7: a figure on screen says its age). */
export const SNAPSHOT_NOTE_AFTER_MS = 60_000;

/**
 * While the page shows a saved snapshot (lib/snapshots.ts): "Updated 10:42 · refreshing" once it is over a minute old,
 * and "Couldn't refresh · Updated 10:42" with Retry when the fresh read failed. Gone as soon as fresh data lands.
 */
export function SnapshotNote() {
  useSnapshotView();
  const s = snapshotState();
  if (!s || (!s.failed && Date.now() - s.savedAt < SNAPSHOT_NOTE_AFTER_MS)) return null;
  const at = time(new Date(s.savedAt).toISOString());
  return (
    <span role="status" className="inline-flex items-center gap-2 text-meta text-muted-ink whitespace-nowrap">
      {s.failed ? `Couldn't refresh · Updated ${at}` : `Updated ${at} · refreshing`}
      {s.failed && <Button size="sm" variant="tertiary" live onClick={retrySnapshots}>Retry</Button>}
    </span>
  );
}

/** The menu group of a screen, for the eyebrow. Nothing when the group would only repeat the title. */
function eyebrowFor(path: string, title: string): string | null {
  const nav = findNav(path);
  if (!nav) return null;
  return nav.group && nav.group.toLowerCase() !== title.toLowerCase() ? nav.group : null;
}

/** Only plain buttons fold: a control with its own pop-up (a date picker, a split button) stays where it is. */
const foldable = (n: ReactNode): n is ReactElement => isValidElement(n) && (n.type === Button || n.type === ButtonLink);

/** Fragments are unwrapped so `<>{a}{b}</>` counts as two actions. */
function flatten(nodes: ReactNode): ReactNode[] {
  return Children.toArray(nodes).flatMap(n => (isValidElement<{ children?: ReactNode }>(n) && n.type === Fragment ? flatten(n.props.children) : [n]));
}

/**
 * The header's action row: secondary actions, `children` (a page's own controls), then the primary button.
 * Below 900px every plain secondary button folds into one "More" menu, so a phone shows [More] [Primary] on one line
 * instead of a wall of buttons. Anything that is not a plain Button stays in the row. On a phone the primary leads.
 */
export function HeaderActions({ actions, primary, children }: { actions?: ReactNode; primary?: ReactNode; children?: ReactNode }) {
  const narrow = useMedia('(max-width: 899.98px)');
  const items = flatten(actions);
  const fold = narrow ? items.filter(foldable) : [];
  const keep = narrow ? items.filter(n => !foldable(n)) : items;
  return (
    <>
      {keep}
      {fold.length === 1 ? fold : fold.length > 1 && <MoreMenu>{fold}</MoreMenu>}
      {children}
      {/* On a phone the buttons wrap under the title; the primary one leads there instead of trailing on its own line. */}
      {primary && <span className="contents max-sm:[&>*]:order-first">{primary}</span>}
    </>
  );
}

function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={box} className="ds-more">
      <Button size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><span className="inline-flex items-center gap-1.5">More<Icon name="ChevronDown" size="sm" /></span></Button>
      {/* A pick closes the menu; the button's own onClick still runs. */}
      {open && <div role="menu" className="ds-more-menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
