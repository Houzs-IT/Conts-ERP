import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TONE, cx } from '../lib/design-tokens';
import { count } from '../lib/format';
import type { Tone } from '../lib/types';

/* Shared figure pieces for Dashboard, Portfolio and Performance, so the three read as one set. */

/** Small uppercase label above a figure or a section. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  // cx only joins classes, so a colour passed in would lose to the default grey on CSS order; the grey applies only when none is given.
  const coloured = /(^|\s)text-(?!caption|meta|copy|heading|title|headline|\[)[a-z]/.test(className ?? '');
  return <span className={cx('text-caption font-semibold uppercase tracking-[0.09em]', !coloured && 'text-muted-ink', className)}>{children}</span>;
}

/** "RM 12,450" and "86.2%" with the unit set smaller than the number, so the eye lands on the figure. */
export function Figure({ value, className }: { value: string; className?: string }) {
  let unit: string | null = null, num = value, after = false;
  if (value.startsWith('RM ')) { unit = 'RM'; num = value.slice(3); }
  else if (value.endsWith('%')) { unit = '%'; num = value.slice(0, -1); after = true; }
  return (
    <span className={cx('inline-flex items-baseline whitespace-nowrap tabular-nums', className)} title={value}>
      {unit && !after && <span className="text-[0.5em] font-medium mr-[0.28em] opacity-60 tracking-normal">{unit}</span>}
      <span>{num}</span>
      {unit && after && <span className="text-[0.55em] font-medium ml-[0.12em] opacity-60">{unit}</span>}
    </span>
  );
}

/** One KPI, the single summary tile every page uses.
 *  `hero` is the dark statement card, once per page, for the figure that matters most.
 *  `tone` colours the figure (and tints a warning/critical tile) when the number itself is the alert.
 *  `onClick` makes it a filter or a link; `active` marks the filter that is on. `value` undefined shows a skeleton. */
export function StatTile({ label, value, hint, hintTone, tone, loading, hero, onClick, active, className }: {
  label: string; value: string | undefined; hint?: ReactNode; hintTone?: Tone; tone?: Tone;
  loading?: boolean; hero?: boolean; onClick?: () => void; active?: boolean; className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  const alert = !hero && (tone === 'warning' || tone === 'critical');
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick && active !== undefined ? active : undefined}
      className={cx(
        '@container relative rounded-card p-4 sm:p-5 flex flex-col gap-3 min-w-0 overflow-hidden text-left',
        hero ? 'bg-black text-white' : cx('border border-solid', alert ? TONE[tone].bg : 'bg-card',
          active ? 'border-black shadow-[0_0_0_1px_var(--color-black)]' : alert ? 'border-warning-line' : 'border-line'),
        onClick && 'cursor-pointer transition-[border-color,box-shadow] duration-[var(--motion-fast)] hover:border-line-strong hover:shadow-[var(--shadow-raised)]',
        className,
      )}>
      {hero && <span aria-hidden className="absolute left-4 sm:left-5 top-0 h-[2px] w-8 bg-gold" />}
      <Eyebrow className={hero ? 'text-gold' : alert ? TONE[tone].text : undefined}>{label}</Eyebrow>
      {loading || value === undefined
        ? <div className={cx('skeleton h-8 w-3/4', hero && 'opacity-20')} />
        : <Figure value={value} className={cx(
            'leading-none font-medium tracking-[-0.025em]',
            // Sized to the tile, so five across on a laptop never clips "RM 121,900".
            hero ? 'text-[clamp(20px,13cqi,40px)]' : 'text-[clamp(16px,12cqi,30px)]',
            hero ? '' : tone && tone !== 'neutral' ? TONE[tone].text : 'text-ink',
          )} />}
      {hint && <div className={cx('text-meta', hero ? 'text-faint' : hintTone ? TONE[hintTone].text : 'text-muted-ink')}>{hint}</div>}
    </Tag>
  );
}

/** A row of StatTiles: two across on phones, up to `cols` across on wide screens. */
export function StatRow({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const wide = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5' }[cols];
  return <div className={cx('grid grid-cols-2 gap-3 sm:gap-4', wide)}>{children}</div>;
}

/** Section heading inside a page: an eyebrow-sized title, an optional count and a right-hand action. */
export function SectionTitle({ title, count, right }: { title: string; count?: number; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[16px] font-semibold tracking-[-0.01em] truncate">{title}</span>
        {count !== undefined && <span className="text-meta text-muted-ink tabular-nums">{count}</span>}
      </div>
      {right}
    </div>
  );
}

/** One choice in a Segmented switch. `count` shows as a quiet number beside the label; `tone` marks a count
 *  that needs attention with a small dot instead of colouring the whole option. */
export interface SegmentOption<K extends string> { key: K; label: ReactNode; count?: number; tone?: 'danger' | 'warning' }

/** Pill-style segmented switch (range, metric, a list's main views). Never wraps: on a narrow screen the
 *  options scroll sideways inside the track. `value` may be a key that is not offered (a filter chosen
 *  elsewhere), and then no option is lit. */
export function Segmented<K extends string>({ label, options, value, onChange, className }: {
  label: string; options: SegmentOption<K>[]; value: K | ''; onChange: (k: K) => void; className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const read = () => setEdges(e => {
      const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      return e.left === left && e.right === right ? e : { left, right };
    });
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', read); ro?.disconnect(); };
  }, [options.length]);
  // The chosen option is never left scrolled out of sight. scrollIntoView would also move the page, so only the track moves.
  useEffect(() => {
    const el = track.current, on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !on) return;
    if (on.offsetLeft < el.scrollLeft) el.scrollLeft = on.offsetLeft - 3;
    else if (on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = on.offsetLeft + on.offsetWidth - el.clientWidth + 3;
  }, [value]);
  // A soft fade on the side that has more options, so a clipped row reads as "scroll for more", not as cut off.
  const fade = edges.left || edges.right
    ? `linear-gradient(to right, ${edges.left ? 'transparent, black 28px' : 'black'}, ${edges.right ? 'black calc(100% - 28px), transparent' : 'black'})`
    : undefined;
  return (
    <div ref={track} role="group" aria-label={label} style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      className={cx('relative inline-flex items-center p-[3px] gap-[2px] rounded-control bg-muted max-w-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {options.map(o => {
        const on = o.key === value;
        const empty = o.count === 0 && !on;
        const flagged = !!o.tone && !!o.count;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={on}
            className={cx(
              'flex-none inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] cursor-pointer text-copy whitespace-nowrap transition-colors duration-[var(--motion-fast)] outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]',
              on ? 'bg-card text-ink font-medium shadow-[var(--shadow-card)]' : empty ? 'text-faint hover:text-muted-ink' : 'text-muted-ink hover:text-ink',
            )}>
            {o.label}
            {o.count !== undefined && (
              <span className={cx('inline-flex items-center gap-1 text-meta font-normal tabular-nums',
                flagged ? (o.tone === 'danger' ? 'text-danger' : 'text-warning') : empty ? 'text-faint' : 'text-muted-ink')}>
                {flagged && <span aria-hidden className={cx('w-1.5 h-1.5 rounded-full', o.tone === 'danger' ? 'bg-danger-line' : 'bg-warning-line')} />}
                {count(o.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TrendBar {
  key: string;
  /** Under the bar: "Sep". */
  label: string;
  /** Second line under the label, e.g. the year where it changes. */
  sub?: string;
  value: number;
  /** Above the bar: "122k". */
  display: string;
  /** Tooltip body. */
  title: string;
  current?: boolean;
  /** Third line under the label in gold, e.g. that month's occupancy. */
  lineDisplay?: string;
}

/** Bar chart in HTML rather than a scaled SVG, so its text stays at real pixel sizes on a phone.
 *  The current period is gold, the rest charcoal. */
export function BarTrend({ bars, height = 200, lineLabel }: { bars: TrendBar[]; height?: number; lineLabel?: string }) {
  const max = Math.max(1, ...bars.map(b => b.value));
  const many = bars.length > 6;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map(g => (
          <div key={g} aria-hidden className="absolute left-0 right-0 [border-top:1px_dashed_var(--color-line-soft)]" style={{ bottom: `${g * 82}%` }} />
        ))}
        <div className="absolute inset-0 [border-bottom:1px_solid_var(--color-line)]" aria-hidden />

        <div className={cx('absolute inset-0 flex items-end', many ? 'gap-1 sm:gap-2' : 'gap-3 sm:gap-6')}>
          {bars.map((b, i) => {
            const key = b.current || b.value === max;
            // The card clips overflow, so the tooltips of the outer bars open inwards.
            const edge = i < 2 ? 'left-0' : i >= bars.length - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2';
            const h = b.value > 0 ? Math.max(2, (b.value / max) * 82) : 0.5;
            return (
              <div key={b.key} className="group relative flex-1 min-w-0 h-full flex flex-col justify-end items-center">
                <span className={cx(
                  'mb-1.5 text-caption tabular-nums whitespace-nowrap transition-colors',
                  b.current ? 'text-ink font-semibold' : 'text-muted-ink',
                  !key && many && 'hidden sm:block',
                )}>{b.display}</span>
                <div
                  className={cx(
                    'w-full max-w-[40px] rounded-t-[4px] origin-bottom [animation:grow_520ms_var(--ease-out)_both] transition-[filter,opacity] duration-[var(--motion-fast)]',
                    b.current ? 'bg-gold' : 'bg-gradient-to-b from-charcoal to-black',
                    'group-hover:brightness-125',
                  )}
                  style={{ height: `${h}%`, animationDelay: `${i * 28}ms` }} />
                <div role="tooltip"
                  className={cx('pointer-events-none absolute bottom-full mb-1 z-10', edge, ' opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)] rounded-[6px] bg-black text-white text-meta px-2.5 py-1.5 whitespace-nowrap shadow-[var(--shadow-overlay)]')}>
                  {b.title}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <div className={cx('flex', many ? 'gap-1 sm:gap-2' : 'gap-3 sm:gap-6')}>
        {bars.map(b => (
          <div key={b.key} className="flex-1 min-w-0 flex flex-col items-center leading-tight">
            <span className={cx('text-caption whitespace-nowrap', b.current ? 'font-semibold text-ink' : 'text-muted-ink')}>{b.label}</span>
            <span className="text-caption text-faint whitespace-nowrap h-4">{b.sub ?? ''}</span>
            {b.lineDisplay && <span className="hidden sm:block text-caption text-gold-ink whitespace-nowrap tabular-nums">{b.lineDisplay}</span>}
          </div>
        ))}
      </div>

      {lineLabel && (
        <div className="hidden sm:flex items-center justify-end gap-1.5 text-caption text-muted-ink">
          <span className="w-2 h-2 rounded-full bg-gold-ink" />{lineLabel}
        </div>
      )}
    </div>
  );
}

/** The four statement totals under a chart: distinct definitions, never merged. */
export function TotalsRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 pt-4 [border-top:1px_solid_var(--color-line-soft)]">
      {items.map(t => (
        <div key={t.label} className="flex flex-col gap-1.5 min-w-0">
          <Eyebrow>{t.label}</Eyebrow>
          <Figure value={t.value} className="text-[17px] sm:text-[19px] font-medium tracking-[-0.015em] text-ink" />
        </div>
      ))}
    </div>
  );
}
