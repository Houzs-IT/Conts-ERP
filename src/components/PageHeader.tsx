import { type ReactNode } from 'react';
import { color, text } from '../theme';
import Icon from './Icon';

/**
 * Title, a one-line subtitle (count and period, no developer notes), and the actions at the top right.
 * Put secondary actions in `actions` and the one primary action last in `primary`, so every page reads
 * the same way: [secondary] [secondary] [Primary]. `right` is kept for pages that build their own row.
 * `back` adds a small "‹ All owners" link above the title for record pages.
 */
export default function PageHeader({ title, sub, right, actions, primary, back, badge }: {
  title: string; sub?: ReactNode; right?: ReactNode;
  actions?: ReactNode; primary?: ReactNode;
  back?: { label: string; onClick: () => void };
  badge?: ReactNode;
}) {
  const hasActions = !!(actions || primary || right);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      {back && (
        <button type="button" onClick={back.onClick} data-print-hide
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: text.copy, color: color.textMuted }}>
          <Icon name="ChevronLeft" size="sm" /> {back.label}
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: text.headline, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{title}</h1>
            {badge}
          </div>
          {sub && <div style={{ fontSize: text.meta, color: color.textMuted }}>{sub}</div>}
        </div>
        {hasActions && (
          // Right-aligned beside the title; once wrapped under it on a phone, left-aligned with it, not a ragged right stack.
          <div data-print-hide className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
            {actions}
            {right}
            {primary}
          </div>
        )}
      </div>
    </div>
  );
}
