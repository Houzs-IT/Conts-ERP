import { type ReactNode, type CSSProperties } from 'react';
import { color, radius, text, shadow } from '../theme';

export function Card({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
      background: color.card, border: `1px solid ${color.borderMuted}`, borderRadius: radius.card, overflow: 'hidden',
      boxShadow: shadow.card,
      // `main` (AppShell) is a column flexbox with overflowY: auto, so it scrolls once its content is
      // taller than the viewport — but a flex item with overflow != visible gets an automatic min-height
      // of 0 (CSS flexbox spec), so without this a long card gets squeezed to fit main's height instead
      // of pushing it taller, silently clipping rows with no scrollbar in sight. flexShrink: 0 keeps the
      // card at its real content height so main is the thing that grows and scrolls, as intended.
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function CardHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: text.heading, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>
      {right}
    </div>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ font: 'inherit', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer' }}>
      {children}
    </button>
  );
}
