import { type ReactNode } from 'react';
import { color, text } from '../theme';

export default function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: text.pageTitle, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h1>
        {sub && <div style={{ fontSize: text.small, color: color.textMuted }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
