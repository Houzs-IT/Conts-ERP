import { color } from '../theme';

/**
 * Every logo position in the product renders this. The artwork is the company's own mark
 * (public/brand/the-conts-logo.png, cropped from their report), recoloured to the brand gold by
 * scripts/brand/make-logo-variants.py: mark-gold.png (the towers) and logo-gold.png (towers + THE CONTS).
 * The gold reads on black; on a light surface the towers sit on a black tile so they never wash out.
 */

const MARK = { src: '/brand/mark-gold.png', w: 117, h: 136 };
const LOCKUP = { src: '/brand/logo-gold.png', w: 195, h: 162 };

export function Logo({ variant = 'full', size = 'md', onDark = false, product = false }: {
  variant?: 'full' | 'mark' | 'wordmark';
  size?: 'sm' | 'md' | 'lg';
  onDark?: boolean;
  /** The app's own lockup (sidebar): "Property OS" under the wordmark, as in the desktop design. */
  product?: boolean;
}) {
  const height = { sm: 28, md: 40, lg: 50 }[size];
  const ink = onDark ? '#FFFFFF' : color.ink;
  const muted = onDark ? color.dim : color.textMuted;

  // The large lockup on dark (the login hero) is the company's artwork itself.
  if (variant === 'full' && size === 'lg' && onDark && !product) {
    const h = 112;
    return <img src={LOCKUP.src} alt="The Conts" width={Math.round(LOCKUP.w * h / LOCKUP.h)} height={h} style={{ display: 'block' }} />;
  }

  const towers = (h: number) => (
    <img src={MARK.src} alt="" aria-hidden width={Math.round(MARK.w * h / MARK.h)} height={h} style={{ display: 'block', flex: 'none' }} />
  );
  const mark = onDark
    ? <div aria-hidden style={{ width: height, height, flex: 'none', display: 'grid', placeItems: 'center' }}>{towers(height)}</div>
    : (
      <div aria-hidden style={{ width: height, height, flex: 'none', borderRadius: Math.round(height * 0.24), background: color.black, display: 'grid', placeItems: 'center' }}>
        {towers(Math.round(height * 0.72))}
      </div>
    );

  if (variant === 'mark') return <span role="img" aria-label="The Conts" style={{ display: 'inline-flex' }}>{mark}</span>;

  const wordmark = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size === 'sm' ? 2 : 4 }}>
      <span style={{
        fontSize: size === 'sm' ? 12 : size === 'lg' ? 16 : 14,
        fontWeight: 600, letterSpacing: '0.18em', color: onDark ? '#FFFFFF' : ink,
      }}>THE CONTS</span>
      {product
        // The sidebar lockup has to fit beside the collapse button (about 136px); the design names the
        // product there instead of squeezing the tagline below the 11px minimum.
        ? <span style={{ fontSize: 11, lineHeight: 1.35, color: muted, whiteSpace: 'nowrap' }}>Property OS</span>
        : <span style={{
            fontSize: 11, letterSpacing: size === 'sm' ? '0.17em' : '0.26em', color: muted, whiteSpace: 'nowrap',
          }}>PROPERTY MANAGEMENT</span>}
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
