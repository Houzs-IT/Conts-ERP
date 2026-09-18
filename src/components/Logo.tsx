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

  const mark = (
    <div
      aria-hidden
      title="Logo placeholder — replace with the approved vector"
      style={{
        width: height, height, flex: 'none', borderRadius: 8,
        border: `1px dashed ${onDark ? color.textMuted : color.borderStrong}`,
        display: 'grid', placeItems: 'center',
        fontSize: Math.max(10, Math.round(height * 0.26)),
        color: muted, letterSpacing: '0.04em',
      }}
    >SVG</div>
  );

  if (variant === 'mark') return mark;

  const wordmark = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size === 'sm' ? 2 : 4 }}>
      <span style={{
        fontSize: size === 'sm' ? 12 : size === 'lg' ? 16 : 14,
        fontWeight: 600, letterSpacing: '0.18em', color: onDark ? '#FFFFFF' : ink,
      }}>THE CONTS</span>
      <span style={{
        fontSize: 11, letterSpacing: '0.26em', color: muted, whiteSpace: 'nowrap',
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
