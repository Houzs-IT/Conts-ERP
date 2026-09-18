import type { CSSProperties, ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'brand' | 'danger';
type Size = 'sm' | 'md' | 'touch';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  /** Required whenever disabled. A disabled control must say why. */
  disabledReason?: string;
}

const base: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  fontFamily: 'var(--font-sans)', fontWeight: 500, whiteSpace: 'nowrap',
  borderRadius: 'var(--radius-control)', border: '1px solid transparent',
  cursor: 'pointer', transition: 'background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out)',
};

const sizes: Record<Size, CSSProperties> = {
  sm:    { height: 'var(--control-height-sm)', padding: '0 13px', fontSize: 13 },
  md:    { height: 'var(--control-height)',    padding: '0 16px', fontSize: 14 },
  touch: { minHeight: 'var(--control-height-touch)', padding: '0 18px', fontSize: 14 },
};

const variants: Record<Variant, CSSProperties> = {
  primary:   { background: 'var(--color-brand-black)', color: 'var(--color-text-inverse)' },
  secondary: { background: 'var(--color-surface-card)', color: 'var(--color-text-primary)', borderColor: 'var(--color-border-default)' },
  tertiary:  { background: 'transparent', color: 'var(--color-text-muted)' },
  brand:     { background: 'transparent', color: 'var(--color-text-accent)', borderColor: 'var(--color-brand-gold)' },
  danger:    { background: 'var(--color-critical-solid)', color: 'var(--color-text-inverse)' },
};

export function Button({
  variant = 'secondary', size = 'md', loading, icon, children, disabled, disabledReason, style, ...rest
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      title={disabled ? disabledReason : rest.title}
      aria-describedby={disabled && disabledReason ? undefined : rest['aria-describedby']}
      style={{
        ...base, ...sizes[size], ...variants[variant],
        ...(isDisabled
          ? { background: 'var(--color-surface-muted)', color: 'var(--color-text-faint)', borderColor: 'transparent', cursor: 'not-allowed' }
          : {}),
        ...style,
      }}
    >
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, flex: 'none', borderRadius: 'var(--radius-full)',
        border: '2px solid rgba(255,255,255,0.35)', borderTopColor: 'currentColor',
        animation: 'spin 700ms linear infinite',
      }}
    />
  );
}
