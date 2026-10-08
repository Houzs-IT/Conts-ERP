import { color } from '../theme';

/**
 * Every logo position in the product renders this. When the vector arrives, drop
 * it at /brand/logo.svg and /brand/mark.svg and delete the Placeholder branch —
 * no page changes anywhere.
 *
 * Brand guide clear space: at least the cap height of the T on every side.
 * Minimum 120px wide for the full lockup, 24px for the mark alone.
 */

const HAS_ARTWORK = false; // flip to true once /brand/logo.svg exists

export function Logo({ variant = 'full', size = 'md', onDark = false }: {
  variant?: 'full' | 'mark' | 'wordmark';
  size?: 'sm' | 'md' | 'lg';
  onDark?: boolean;
}) {
  const height = { sm: 28, md: 40, lg: 50 }[size];
  const ink = onDark ? '#FFFFFF' : color.ink;
  const muted = onDark ? color.dim : color.textMuted;

  if (HAS_ARTWORK) {
    return (
      <img
        src={variant === 'mark' ? '/brand/mark.svg' : '/brand/logo.svg'}
        alt="The Conts"
        style={{ height, width: 'auto', display: 'block' }}
      />
    );
  }

  // Until the approved vector arrives: a TC monogram tile. On the black sidebar a faint gold
  // hairline keeps the tile from dissolving into the background.
  const mark = (
    <div
      aria-hidden
      style={{
        width: height, height, flex: 'none', borderRadius: Math.round(height * 0.24),
        background: color.black,
        boxShadow: onDark ? 'inset 0 0 0 1px rgba(200,164,106,0.4)' : 'none',
        display: 'grid', placeItems: 'center',
        fontSize: Math.round(height * 0.4), fontWeight: 600, lineHeight: 1,
        color: color.gold, letterSpacing: '0.04em', userSelect: 'none',
      }}
    >TC</div>
  );

  if (variant === 'mark') return mark;

  const wordmark = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size === 'sm' ? 2 : 4 }}>
      <span style={{
        fontSize: size === 'sm' ? 12 : size === 'lg' ? 16 : 14,
        fontWeight: 600, letterSpacing: '0.18em', color: onDark ? '#FFFFFF' : ink,
      }}>THE CONTS</span>
      <span style={{
        // The small lockup has to fit beside the sidebar's collapse button (about 136px).
        fontSize: size === 'sm' ? 8.5 : 11, letterSpacing: size === 'sm' ? '0.17em' : '0.26em', color: muted, whiteSpace: 'nowrap',
      }}>PROPERTY MANAGEMENT</span>
    </div>
  );

  if (variant === 'wordmark') return wordmark;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size === 'sm' ? 11 : 15 }}>
      {mark}
      {wordmark}
    </div>
  );
}
