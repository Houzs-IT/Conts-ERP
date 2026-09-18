import { type ReactNode, type CSSProperties } from 'react';
import { color, radius, text } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

export function CardHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ padding: '18px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>{title}</span>
      {right}
    </div>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
      {children}
    </button>
  );
}
