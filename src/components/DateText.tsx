import type { CSSProperties } from 'react';
import { date, dateRange, dateShort, dateTime, monthLabel, relative, time } from '../lib/format';

/**
 * Every rendered date goes through docs/DATE-FORMAT.md's helpers. This wraps them in a <time> element
 * (so the machine value is kept for screen readers and copy) and makes the raw ISO string impossible
 * to print by accident.
 *   kind: date 16 Sep 2026 · short 16 Sep · month Sep 2026 · time 15:00 · dateTime 16 Sep 2026 14:06
 *         · relative 2 hours ago · range 16 Sep – 29 Sep 2026 (pass `to`)
 */
export function DateText({ iso, to, kind = 'date', fallback = '—', style, className }: {
  iso: string | null | undefined; to?: string | null;
  kind?: 'date' | 'short' | 'month' | 'time' | 'dateTime' | 'relative' | 'range';
  fallback?: string; style?: CSSProperties; className?: string;
}) {
  if (!iso) return <span className={className} style={style}>{fallback}</span>;
  const label = kind === 'range' && to ? dateRange(iso, to)
    : kind === 'short' ? dateShort(iso)
    : kind === 'month' ? monthLabel(iso)
    : kind === 'time' ? time(iso)
    : kind === 'dateTime' ? dateTime(iso)
    : kind === 'relative' ? relative(iso)
    : date(iso);
  return <time dateTime={iso} title={kind === 'relative' ? dateTime(iso) : undefined} className={className} style={{ whiteSpace: 'nowrap', ...style }}>{label}</time>;
}
