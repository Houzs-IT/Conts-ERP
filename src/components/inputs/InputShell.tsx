import { type ReactNode } from 'react';

/** Label above, message below: the same layout as Field, so swapped-in inputs look identical.
 *  With no `label` the input renders bare (table cells, toolbars), labelled by aria-label. */
export function InputShell({ id, label, help, error, trailing, leading, children }: {
  id: string;
  label?: string;
  help?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
}) {
  const message = error || help;
  const adorned = trailing || leading
    ? (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leading && <span aria-hidden style={{ position: 'absolute', left: 12, display: 'flex', pointerEvents: 'none' }}>{leading}</span>}
        {children}
        {trailing && <span style={{ position: 'absolute', right: 12, display: 'flex' }}>{trailing}</span>}
      </div>
    )
    : children;
  if (label === undefined) {
    if (!message) return <>{adorned}</>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {adorned}
        <span id={`${id}-help`} role={error ? 'alert' : undefined} style={{ fontSize: 'var(--text-small)', color: error ? 'var(--color-critical-fg)' : 'var(--color-text-muted)' }}>{message}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      {label !== '' && (
        <label htmlFor={id} style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</label>
      )}
      {adorned}
      {message && (
        <span id={`${id}-help`} role={error ? 'alert' : undefined} style={{ fontSize: 'var(--text-small)', color: error ? 'var(--color-critical-fg)' : 'var(--color-text-muted)' }}>{message}</span>
      )}
    </div>
  );
}

/** Phone-sized tap target and 16px text (iOS zooms the page into any field under 16px) below the sm breakpoint.
 *  A plain rule rather than Tailwind's max-sm: utilities: .field-input sits outside the cascade layers, so it
 *  would beat any utility; this rule comes later and is more specific. */
export const PHONE_SIZING = 'ci-input';
if (typeof document !== 'undefined' && !document.getElementById('ci-input-css')) {
  const s = document.createElement('style');
  s.id = 'ci-input-css';
  s.textContent = '@media (max-width: 639.98px) { input.ci-input { font-size: 16px; min-height: 40px; } }';
  document.head.appendChild(s);
}
