import Icon from './Icon';
import { cx } from '../lib/design-tokens';
import { count } from '../lib/format';

const n = count;

/** "1–50 of 4,150" with previous/next and an optional rows-per-page picker, for server-paged lists. */
export function PageControls({ page, pageSize, total, onPage, onSize, sizes = [25, 50, 100], noun = 'rows', className }: {
  page: number; pageSize: number; total: number;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
  sizes?: number[];
  noun?: string;
  className?: string;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const btn = 'w-8 h-8 grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer disabled:cursor-not-allowed disabled:text-faint disabled:bg-muted';
  return (
    <div className={cx('flex items-center justify-between gap-3 flex-wrap py-[10px] px-[22px] text-meta text-muted-ink', className)}>
      <span className="[font-variant-numeric:tabular-nums]">{total ? `${n(from)}–${n(to)} of ${n(total)} ${noun}` : `0 ${noun}`}</span>
      <div className="flex items-center gap-2">
        {onSize && (
          <label className="flex items-center gap-[6px]">
            <span className="max-sm:hidden">Rows</span>
            <span className="relative inline-flex items-center">
              <select value={pageSize} onChange={e => onSize(Number(e.target.value))} aria-label="Rows per page"
                className="h-8 pl-2.5 pr-7 appearance-none rounded-control border border-solid border-line bg-card text-ink [font-family:inherit] text-meta tabular-nums cursor-pointer hover:border-line-strong">
                {sizes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span aria-hidden className="pointer-events-none absolute right-2 text-muted-ink"><Icon name="ChevronDown" size="sm" /></span>
            </span>
          </label>
        )}
        <span className="[font-variant-numeric:tabular-nums] px-1">Page {n(page)} of {n(last)}</span>
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" title="Previous page">
          <Icon name="ChevronLeft" size="sm" />
        </button>
        <button type="button" className={btn} disabled={page >= last} onClick={() => onPage(page + 1)} aria-label="Next page" title="Next page">
          <Icon name="ChevronRight" size="sm" />
        </button>
      </div>
    </div>
  );
}
