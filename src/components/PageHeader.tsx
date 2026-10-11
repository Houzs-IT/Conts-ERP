import { type ReactNode } from 'react';
import { color, text } from '../theme';
import Icon from './Icon';
import { useMarkPagePrimary } from './States';

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
  useMarkPagePrimary(!!primary);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      {back && (
        <button type="button" onClick={back.onClick} data-print-hide
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: text.copy, color: color.textMuted }}>
          <Icon name="ChevronLeft" size="sm" /> {back.label}
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <h1 className="m-0 text-[24px] sm:text-[30px] leading-[1.15] font-semibold tracking-[-0.025em] [overflow-wrap:anywhere]">{title}</h1>
            {badge}
          </div>
          {sub && <div style={{ fontSize: text.copy, color: color.textMuted }}>{sub}</div>}
        </div>
        {hasActions && (
          // Right-aligned beside the title; once wrapped under it on a phone, left-aligned with it, not a ragged right stack.
          <div data-print-hide className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
            {actions}
            {right}
            {/* On a phone the buttons wrap under the title; the primary one leads there instead of trailing on its own line. */}
            {primary && <span className="contents max-sm:[&>*]:order-first">{primary}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
