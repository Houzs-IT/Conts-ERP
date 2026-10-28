import { useState } from 'react';
import { cx } from '../../lib/design-tokens';

/** Charts for the unit P&L report (plan docs/superpowers/plans/2026-10-28-unit-pnl.md): plain SVG, colours from the
 *  theme's CSS variables so both themes work. Values in sen. */

export interface TrendPoint { key: string; label: string; a: number; b: number }

/** Two bars per month (layer one and layer two) around a zero line; losses drop below it in the danger colour. */
export function TwoLayerTrend({ points, aLabel, bLabel, format, height = 220 }: {
  points: TrendPoint[]; aLabel: string; bLabel: string; format: (sen: number) => string; height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const values = points.flatMap(p => [p.a, p.b]);
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const pad = 22, h = height - pad * 2;
  const y = (v: number) => pad + ((max - v) / span) * h;
  const W = 100, slot = W / Math.max(1, points.length), bar = Math.min(6, slot / 3.2);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-meta text-muted-ink justify-end">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[var(--color-chart-ink)]" />{aLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[var(--color-gold)]" />{bLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[var(--color-danger-line)]" />Loss</span>
      </div>
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img"
          aria-label={`${aLabel} and ${bLabel} by month`}>
          <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => {
            const cx0 = slot * i + slot / 2;
            return [p.a, p.b].map((v, j) => (
              <rect key={`${p.key}${j}`} x={cx0 + (j ? 0.4 : -bar - 0.4)} width={bar} y={Math.min(y(v), y(0))} height={Math.max(0.5, Math.abs(y(v) - y(0)))}
                rx="0.6" fill={v < 0 ? 'var(--color-danger-line)' : j ? 'var(--color-gold)' : 'var(--color-chart-ink)'}
                opacity={hover && hover !== p.key ? 0.45 : 1} />
            ));
          })}
        </svg>
        <div className="absolute inset-0 flex">
          {points.map(p => (
            <div key={p.key} className="relative flex-1 h-full" onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
              {hover === p.key && (
                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 z-10 rounded-[6px] bg-black text-white text-meta px-2.5 py-1.5 whitespace-nowrap shadow-[var(--shadow-overlay)]">
                  <div className="font-semibold">{p.label}</div>
                  <div>{aLabel}: {format(p.a)}</div>
                  <div>{bLabel}: {format(p.b)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex">
        {points.map(p => <div key={p.key} className="flex-1 text-center text-meta text-muted-ink truncate">{p.label}</div>)}
      </div>
    </div>
  );
}

export interface ShareSeries { key: string; label: string; color: string }

/** Each month's costs as stacked shares of the guest total (percent), one colour per cost line. */
export function CostShare({ months, series, share }: {
  months: { key: string; label: string }[]; series: ShareSeries[]; share: (month: string, series: string) => number | null;
}) {
  const totals = months.map(m => series.reduce((n, s) => n + (share(m.key, s.key) ?? 0), 0));
  const top = Math.max(10, Math.ceil(Math.max(0, ...totals) / 10) * 10);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-ink justify-end">
        {series.map(s => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="flex items-end gap-2 sm:gap-4 h-[200px] [border-bottom:1px_solid_var(--color-line)]">
        {months.map((m, i) => (
          <div key={m.key} className="group relative flex-1 h-full flex flex-col justify-end items-center">
            <span className="text-meta tabular-nums text-muted-ink mb-1">{totals[i] ? `${totals[i].toFixed(1)}%` : '–'}</span>
            <div className="w-full max-w-[44px] flex flex-col-reverse rounded-t-[4px] overflow-hidden" style={{ height: `${(totals[i] / top) * 85}%` }}>
              {series.map(s => {
                const v = share(m.key, s.key) ?? 0;
                return v > 0 ? <div key={s.key} title={`${s.label}: ${v.toFixed(1)}%`} style={{ background: s.color, height: `${(v / (totals[i] || 1)) * 100}%` }} /> : null;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 sm:gap-4">
        {months.map(m => <div key={m.key} className={cx('flex-1 text-center text-meta text-muted-ink truncate')}>{m.label}</div>)}
      </div>
    </div>
  );
}
