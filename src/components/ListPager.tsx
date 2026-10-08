import Icon from './Icon';
import { cx } from '../lib/design-tokens';

/** "21–40 of 312" with previous / next. Sits under a paged list; renders nothing for a single page. */
export function ListPager({ page, pageSize, total, onPage, busy, noun = 'rows' }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; busy?: boolean; noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  const btn = 'w-9 h-9 grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer text-ink hover:bg-muted disabled:cursor-default disabled:text-faint disabled:hover:bg-card';
  return (
    <div className="flex items-center justify-between gap-3 py-[10px] px-5 [border-top:1px_solid_var(--color-line-soft)]">
      <span className="text-[12.5px] text-muted-ink [font-variant-numeric:tabular-nums]" aria-live="polite">
        {from.toLocaleString('en-MY')}–{to.toLocaleString('en-MY')} of {total.toLocaleString('en-MY')} {noun}
      </span>
      <div className={cx('flex items-center gap-2', busy && 'opacity-60')}>
        <span className="hidden sm:inline text-[12.5px] text-muted-ink [font-variant-numeric:tabular-nums]">Page {page} of {pages}</span>
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="ChevronLeft" size="sm" /></button>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="ChevronRight" size="sm" /></button>
      </div>
    </div>
  );
}
