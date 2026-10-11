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
  // Longhands only: the variants and the disabled state set borderColor, and React warns when a
  // `border` shorthand and a borderColor longhand change between renders.
  borderRadius: 'var(--radius-control)', borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
  cursor: 'pointer', transition: 'background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out)',
  // Hover, press and focus come from .ui-btn in src/styles/tokens.css: an inline style cannot express :hover.
  position: 'relative', isolation: 'isolate',
};

const sizes: Record<Size, CSSProperties> = {
  sm:    { height: 'var(--control-height-sm)', padding: '0 13px', fontSize: 13 },
  md:    { height: 'var(--control-height)',    padding: '0 16px', fontSize: 13 },
  touch: { minHeight: 'var(--control-height-touch)', padding: '0 18px', fontSize: 15 },
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
  // Busy keeps the button's own colours and label, with a spinner in front: the person sees which action is running.
  // Only a truly disabled button greys out.
  const busy = !!loading && !disabled;
  return (
    <button
      {...rest}
      className={['ui-btn', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      title={disabled ? disabledReason : rest.title}
      aria-describedby={disabled && disabledReason ? undefined : rest['aria-describedby']}
      style={{
        ...base, ...sizes[size], ...variants[variant],
        ...(busy
          ? { cursor: 'progress', opacity: 0.88 }
          : isDisabled
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
        // A ring in the label's colour with one quarter open, so it reads on dark, light and gold buttons alike.
        borderWidth: 2, borderStyle: 'solid', borderColor: 'currentColor', borderRightColor: 'transparent', opacity: 0.85,
        animation: 'spin 700ms linear infinite',
      }}
    />
  );
}
