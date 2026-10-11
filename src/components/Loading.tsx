import { useEffect, useSyncExternalStore } from 'react';
import { cx } from '../lib/design-tokens';
import { refreshingCount, subscribeRefreshing } from '../lib/useApi';

/* Every loading moment draws from these pieces, so a route change, a first load and a refresh read as one system. */

/** A gold sliver that travels along a 2px track: something already on screen is being refreshed.
 *  It fades in only after a short wait, so a refresh that answers at once never flickers. */
export function BusyLine({ on, className }: { on: boolean; className?: string }) {
  return (
    <div aria-hidden className={cx('busy-line', on && 'is-on', className)}>
      <div className="busy-line-bar" />
    </div>
  );
}

/** The app-wide refresh line at the top of the content area, lit while any read is refreshing figures already shown. */
export function RefreshLine() {
  const n = useSyncExternalStore(subscribeRefreshing, refreshingCount, refreshingCount);
  return <BusyLine on={n > 0} className="z-[60]" />;
}

// Read before React replaces #root: index.html carries the mark inline, so the boot screen never waits on a request for it.
const BOOT_MARK = typeof document !== 'undefined'
  ? document.querySelector<HTMLImageElement>('#root .boot-mark img')?.getAttribute('src') ?? '/brand/mark-gold.png'
  : '/brand/mark-gold.png';

/* True once a page has finished loading in the shell. Until then the page placeholder shows at once: right after
   the opening screen there is no earlier page to keep on screen, so a delay would only leave the content area empty. */
let pageShown = false;
/** Rendered beside the routed page inside Suspense; it commits only when the page itself does. */
export function PageShown() {
  useEffect(() => { pageShown = true; }, []);
  return null;
}

/** Shown while the session is checked: the gold mark on the page colour, a quiet line beneath it.
 *  index.html draws the same markup before the script runs, so the hand-over is seamless. */
export function BootScreen() {
  return (
    <div className="boot-screen boot-live" role="status" aria-label="Opening The Conts">
      <div className="boot-mark"><img src={BOOT_MARK} alt="" width={31} height={36} /></div>
      <div className="boot-track"><div className="boot-bar" /></div>
    </div>
  );
}

function Bar({ className }: { className: string }) {
  return <div className={cx('skeleton', className)} />;
}

/** The frame of one StatTile with its label and figure as blocks, the same height as the tile it becomes. */
export function TileSkeleton({ hero, hint, className }: { hero?: boolean; hint?: boolean; className?: string }) {
  return (
    <div aria-hidden className={cx('@container relative rounded-card p-4 sm:p-5 flex flex-col gap-3 min-w-0 overflow-hidden',
      hero ? 'bg-black' : 'bg-card border border-solid border-line', className)}>
      {hero && <span className="absolute left-4 sm:left-5 top-0 h-[2px] w-8 bg-gold" />}
      <div className={cx('skeleton h-[11px] my-[2px] w-1/2', hero && 'skeleton-on-dark')} />
      <div className={cx('skeleton w-3/4', hero ? 'h-[clamp(20px,13cqi,40px)] skeleton-on-dark' : 'h-[clamp(16px,12cqi,30px)]')} />
      {hint && <div className={cx('skeleton h-[10px] my-[4px] w-2/5', hero && 'skeleton-on-dark')} />}
    </div>
  );
}

/** Rows shaped like DataTable's: a header strip, then 52px rows with a strong first column and quieter cells. */
export function RowsSkeleton({ rows = 6, cols = 5, header = true }: { rows?: number; cols?: number; header?: boolean }) {
  const widths = ['w-[62%]', 'w-[44%]', 'w-[52%]', 'w-[38%]', 'w-[48%]', 'w-[34%]', 'w-[42%]'];
  const grid = { gridTemplateColumns: `minmax(0,1.6fr) repeat(${Math.max(cols - 1, 0)}, minmax(0,1fr))` };
  return (
    <div aria-hidden>
      {header && (
        <div className="grid gap-[14px] px-[22px] h-[38px] items-center bg-muted [border-bottom:1px_solid_var(--color-line)]" style={grid}>
          {Array.from({ length: cols }, (_, c) => <div key={c} className="skeleton skeleton-quiet h-[9px] w-[40%]" />)}
        </div>
      )}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-[14px] px-[22px] h-[52px] items-center [border-bottom:1px_solid_var(--color-line-soft)]" style={grid}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={cx('skeleton', c === 0 ? 'h-[12px]' : 'h-[10px]', widths[(c + r) % widths.length], c === cols - 1 && cols > 2 && 'justify-self-end')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A page whose code is still downloading: title and subtitle, a row of tiles, then a list card.
 *  Once the app is open it fades in after 150ms, so a page that arrives quickly never shows it at all. */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className={cx(pageShown && 'page-skeleton', 'flex flex-col gap-4 sm:gap-5 min-w-0')} role="status" aria-label="Loading">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-[10px] min-w-0 flex-1">
          <Bar className="h-[26px] sm:h-[32px] w-[min(240px,60%)] rounded-control" />
          <Bar className="h-[11px] w-[min(200px,45%)]" />
        </div>
        <Bar className="max-sm:hidden h-[32px] w-[132px] rounded-control" />
      </div>
      {tiles > 0 && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: tiles }, (_, i) => <TileSkeleton key={i} className={i >= 2 ? 'max-xl:hidden' : undefined} />)}
        </div>
      )}
      <div className="bg-card border border-solid border-line rounded-card overflow-hidden shrink-0">
        <div className="flex items-center gap-3 px-[22px] py-[14px] max-md:px-4">
          <Bar className="h-[32px] w-[min(260px,55%)] rounded-control" />
          <Bar className="ml-auto h-[32px] w-[88px] rounded-control" />
        </div>
        <div className="max-md:hidden"><RowsSkeleton rows={7} cols={5} /></div>
        <div className="md:hidden"><CardRowsSkeleton rows={5} /></div>
      </div>
    </div>
  );
}

/** Phone list rows: a title with an amount, a muted line under it. */
export function CardRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex flex-col gap-[9px] px-4 py-[14px] [border-top:1px_solid_var(--color-line-soft)]">
          <div className="flex items-center gap-3">
            <Bar className={cx('h-[12px]', r % 2 ? 'w-[46%]' : 'w-[58%]')} />
            <Bar className="ml-auto h-[12px] w-[22%]" />
          </div>
          <Bar className={cx('h-[10px]', r % 2 ? 'w-[64%]' : 'w-[52%]')} />
        </div>
      ))}
    </div>
  );
}
