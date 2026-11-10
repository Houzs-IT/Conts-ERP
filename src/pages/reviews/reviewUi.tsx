import { useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import Icon from '../../components/Icon';
import { cx } from '../../lib/design-tokens';
import { categoryLabel, categoryFlagged, scaleText, type Scale } from '../../lib/reviewRules';

/* Pieces of the Reviews screens laid out the way Airbnb's host Reviews page is (owner, 3 Nov 2026): a big overall
 * score with a star, a row per category with its icon, score and a thin bar, the 5-to-1 spread, review cards with the
 * guest's initials, the stay, the stars and a "Show more", the host's response under the review. Our tokens and
 * fonts, no Airbnb marks. Booking.com keeps its own look: a score out of 10 in a box, and Liked / Disliked. */

/** Icons already in the app's icon set (adding new ones grows the first download). */
export const CATEGORY_ICON: Readonly<Record<string, string>> = {
  cleanliness: 'Sparkles', accuracy: 'CircleCheck', checkin: 'KeyRound', communication: 'MessageSquare', location: 'MapPin', value: 'Tag',
  staff: 'Users', facilities: 'Building2', comfort: 'Sofa', services: 'BadgeCheck',
};

/** One filled star, sized by the surrounding text (1em). */
export function StarMark({ className }: { className?: string }) {
  return <Star aria-hidden size="1em" fill="currentColor" strokeWidth={0} className={cx('inline-block flex-none', className)} />;
}

export function Stars({ n, max = 5, size = 'sm', label }: { n: number; max?: 5; size?: 'xs' | 'sm' | 'base'; label?: string }) {
  const whole = Math.round(n);
  return (
    <span className={cx('inline-flex gap-px leading-none', size === 'xs' ? 'text-[11px]' : size === 'sm' ? 'text-[14px]' : 'text-[19px]')} role="img" aria-label={label ?? `${n} out of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => <StarMark key={i} className={i < whole ? 'text-ink' : 'text-line'} />)}
    </span>
  );
}

/** A Booking.com score: the number out of 10 in a dark box, as Booking.com shows it. */
export function TenBox({ value, size = 'sm' }: { value: number; size?: 'sm' | 'base' }) {
  return (
    <span className={cx('inline-flex items-center justify-center rounded-[6px_6px_6px_0] bg-black text-white font-semibold tabular-nums',
      size === 'sm' ? 'min-w-[30px] h-[26px] px-1.5 text-meta' : 'min-w-[44px] h-[38px] px-2 text-heading')}
      role="img" aria-label={`${value} out of 10`}>
      {Number.isInteger(value) ? value : value.toFixed(1)}
    </span>
  );
}

/** A score on its channel's own scale: stars for Airbnb (and every channel rated out of 5), the box for Booking.com. */
export function NativeScore({ s, size = 'sm' }: { s: Scale; size?: 'sm' | 'base' }) {
  return s.max === 10
    ? <span className="inline-flex items-center gap-1.5"><TenBox value={s.value} size={size} /><span className="text-meta text-muted-ink">/ 10</span></span>
    : <span className="inline-flex items-center gap-1.5"><Stars n={s.value} size={size} /><span className="text-meta tabular-nums text-muted-ink">{scaleText(s)}</span></span>;
}

const AVATAR_TINTS = ['bg-gold-tint text-gold-ink', 'bg-info-bg text-info', 'bg-success-bg text-success', 'bg-accent-bg text-accent', 'bg-neutral-bg text-neutral'];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? 'G') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  const tint = AVATAR_TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span aria-hidden className={cx('inline-grid place-items-center rounded-full font-semibold shrink-0', tint)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{initials}</span>
  );
}

/** One category the Airbnb way: icon, name, a thin bar and the score. `score` and `max` are on the scale shown. */
export function CategoryRow({ k, score, max, reviews, flagKey }: { k: string; score: number | null; max: 5 | 10; reviews?: number; flagKey?: boolean }) {
  const flagged = !!flagKey && max === 5 && categoryFlagged(k, score);
  return (
    <div className="flex items-center gap-3 min-w-0 py-1.5" title={reviews != null ? `${reviews} ${reviews === 1 ? 'score' : 'scores'}` : undefined}>
      <span className={cx('shrink-0', flagged ? 'text-critical' : 'text-ink-2')}><Icon name={CATEGORY_ICON[k] ?? 'Star'} size="sm" /></span>
      <span className={cx('text-copy flex-1 min-w-0 truncate', flagged && 'text-critical font-medium')}>{categoryLabel(k)}</span>
      <span className="w-[72px] sm:w-[96px] h-[4px] rounded-full bg-line overflow-hidden shrink-0">
        <span className={cx('block h-full rounded-full', flagged ? 'bg-critical' : 'bg-ink')} style={{ width: `${score == null ? 0 : Math.max(0, Math.min(1, score / max)) * 100}%` }} />
      </span>
      <span className={cx('w-9 text-right text-copy font-semibold tabular-nums shrink-0', flagged && 'text-critical')}>{score == null ? '–' : score.toFixed(1)}</span>
    </div>
  );
}

/** Six categories in two columns on a wide screen, one on a phone, Airbnb's order. */
export function CategoryGrid({ keys, scores, max, flag }: { keys: readonly string[]; scores: Record<string, { average: number; reviews: number } | undefined>; max: 5 | 10; flag?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
      {keys.map(k => <CategoryRow key={k} k={k} score={scores[k]?.average ?? null} reviews={scores[k]?.reviews} max={max} flagKey={flag} />)}
    </div>
  );
}

/** Airbnb's "Overall rating" spread: a thin bar per star, 5 down to 1. */
export function Distribution({ stars, total, onPick }: { stars: Record<string, number>; total: number; onPick?: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {[5, 4, 3, 2, 1].map(n => {
        const k = stars[n] ?? 0;
        const pct = total ? (k / total) * 100 : 0;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag key={n} type={onPick ? 'button' : undefined} onClick={onPick ? () => onPick(n) : undefined}
            aria-label={onPick ? `${n} stars: ${k} reviews. Show them.` : undefined}
            className={cx('flex items-center gap-2.5 bg-transparent border-none p-0 text-left [font-family:inherit] text-ink-2', onPick && 'cursor-pointer max-md:min-h-[36px]')}>
            <span className="w-3 text-meta tabular-nums">{n}</span>
            <span className="flex-1 h-[4px] rounded-full bg-line overflow-hidden"><span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} /></span>
            <span className="w-8 text-right text-caption tabular-nums text-muted-ink">{k}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/** Tag chips: green-edged for a compliment, red-edged for a complaint. */
export function TagChips({ tags, counts }: { tags: { code: string; label: string; tone: string; count?: number }[]; counts?: boolean }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(t => (
        <span key={t.code} className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-solid text-meta',
          t.tone === 'negative' ? 'border-critical-line text-critical' : t.tone === 'positive' ? 'border-success-line text-success' : 'border-line text-ink-2')}>
          {t.label}{counts && t.count != null && <span className="font-semibold tabular-nums">{t.count}</span>}
        </span>
      ))}
    </div>
  );
}

/** Long text cut to a few lines with "Show more", as Airbnb's cards do. */
export function Clamp({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 90 || text.split('\n').length > lines;
  return (
    <div className="flex flex-col gap-1 items-start">
      <p className="m-0 text-copy leading-[1.6] [text-wrap:pretty] whitespace-pre-line [overflow-wrap:anywhere]"
        style={!open && long ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)}
          className="bg-transparent border-none p-0 cursor-pointer [font-family:inherit] text-copy font-semibold text-ink underline underline-offset-2">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** A soft notice box (Airbnb's private feedback and "hidden until you review" panels). */
export function Notice({ icon, title, children, tone = 'muted', action }: { icon: string; title: string; children?: ReactNode; tone?: 'muted' | 'warning' | 'critical' | 'info'; action?: ReactNode }) {
  const toneCls = tone === 'warning' ? 'bg-warning-bg border-warning-line' : tone === 'critical' ? 'bg-critical-bg border-critical-line' : tone === 'info' ? 'bg-info-bg border-info-line' : 'bg-muted border-line';
  return (
    <div className={cx('flex items-start gap-3 rounded-card border border-solid px-4 py-3', toneCls)}>
      <span className="mt-0.5 text-ink-2"><Icon name={icon} size="sm" /></span>
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-copy font-semibold">{title}</span>
        {children && <div className="text-meta text-muted-ink [overflow-wrap:anywhere]">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Booking.com sends its review as "Liked: ..." and "Disliked: ..." lines (functions/_lib/channexMessageSync.ts). */
export function splitBooking(comment: string | null): { headline: string | null; liked: string | null; disliked: string | null } {
  if (!comment) return { headline: null, liked: null, disliked: null };
  const lines = comment.split('\n');
  const liked = lines.filter(l => l.startsWith('Liked:')).map(l => l.slice(6).trim()).join(' ') || null;
  const disliked = lines.filter(l => l.startsWith('Disliked:')).map(l => l.slice(9).trim()).join(' ') || null;
  const rest = lines.filter(l => !l.startsWith('Liked:') && !l.startsWith('Disliked:')).join('\n').trim() || null;
  return { headline: rest, liked, disliked };
}

/** "Stayed Oct 2026 · 3 nights", from the stay dates. */
export function stayLine(checkIn: string | null, checkOut: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const n = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 864e5);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(checkIn.slice(5, 7)) - 1];
  return `Stayed ${m} ${checkIn.slice(0, 4)} · ${n} ${n === 1 ? 'night' : 'nights'}`;
}
