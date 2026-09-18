import { TONE } from '../lib/vocabulary';
import type { Tone } from '../lib/types';

/**
 * Status is never colour alone — the label is required, never optional.
 * Renders -fg on bg. The -line value is for dots and borders, never text.
 */
export function Badge({ label, tone, size = 'md' }: { label: string; tone: Tone; size?: 'sm' | 'md' }) {
  const t = TONE[tone];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontSize: size === 'sm' ? 'var(--text-micro)' : 'var(--text-small)',
        fontWeight: 500, lineHeight: 1.35, whiteSpace: 'nowrap',
        padding: size === 'sm' ? '3px 9px' : '4px 10px',
        borderRadius: 'var(--radius-pill)',
        background: t.bg, color: t.fg,
      }}
    >
      {label}
    </span>
  );
}

/** Pairs with a text label. Never used on its own to convey state. */
export function Dot({ tone, live }: { tone: Tone; live?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 6, height: 6, flex: 'none', borderRadius: 'var(--radius-full)',
        background: TONE[tone].line,
        animation: live ? 'pulse-soft 2.4s ease-in-out infinite' : undefined,
      }}
    />
  );
}
