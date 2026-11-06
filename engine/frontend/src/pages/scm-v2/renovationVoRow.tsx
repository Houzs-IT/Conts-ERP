/* The VO list's four columns and its row dropdown (owner, 6 Nov 2026). The server sends only what the record holds; a
   missing value shows as a dash and is never worked out here. */

import { fmtDate, fmtSen } from '../../vendor/shared/format';
import type { VoListDetail, VoListSide } from '../../vendor/scm/lib/so-amendment-queries';

export const voWhatChanged = (v: VoListDetail): string => {
  const parts = [
    v.added ? `${v.added} added` : '',
    v.changed ? `${v.changed} changed` : '',
    v.removed ? `${v.removed} removed` : '',
  ].filter(Boolean);
  return parts.join(', ') || 'No line changes';
};

export const voSignedSen = (sen: number | null): string =>
  sen === null ? '—' : `${sen > 0 ? '+' : sen < 0 ? '-' : ''}${fmtSen(Math.abs(sen))}`;

export const voContract = (v: VoListDetail): string =>
  v.beforeSen === null || v.afterSen === null ? '—' : `${fmtSen(v.beforeSen)} → ${fmtSen(v.afterSen)}`;

export const voPoImpact = (v: VoListDetail): string => {
  if (v.poFixes.length === 0) return 'None';
  const open = new Set(v.poFixes.filter((f) => f.open).map((f) => f.poNumber ?? ''));
  return open.size === 0 ? 'Fixed' : `${open.size} PO to fix`;
};

const sideText = (s: VoListSide | null): string => {
  if (!s || s.qty === null) return '—';
  const qty = `${s.qty}${s.uom ? ` ${s.uom}` : ''}`;
  return s.unitPriceSen === null ? qty : `${qty} × ${fmtSen(s.unitPriceSen)}`;
};

const cell: React.CSSProperties = { padding: '6px 20px 6px 0', textAlign: 'left', whiteSpace: 'nowrap' };

export const VoRowLines = ({ vo, reason }: { vo: VoListDetail | null | undefined; reason: string }) => {
  if (!vo) return <p className="px-3 py-2 text-[12.5px]" style={{ color: 'var(--fg-muted)' }}>No line detail for this row. Open it to see more.</p>;
  const fixes = vo.poFixes.filter((f) => f.open);
  return (
    <div className="space-y-2 px-3 py-2 text-[12.5px]">
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--fg-muted)' }}>
              {['Change', 'Room', 'Item', 'Before', 'After', 'Amount'].map((h) => <th key={h} style={{ ...cell, fontWeight: 600 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {vo.lines.map((l, i) => (
              <tr key={`${l.itemCode ?? ''}-${i}`} style={{ borderTop: '1px solid var(--line, #e5e5e5)' }}>
                <td style={{ ...cell, fontWeight: 600 }}>{l.change}</td>
                <td style={cell}>{l.room ?? '—'}</td>
                <td style={cell}>{l.itemCode ?? l.description ?? '—'}</td>
                <td style={cell}>{l.change === 'Added' ? 'None' : sideText(l.before)}</td>
                <td style={cell}>{l.change === 'Removed' ? 'None' : sideText(l.after)}</td>
                <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{voSignedSen(l.amountSen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--fg-muted)' }}>
        {reason ? `Reason: ${reason}` : ''}
        {vo.signedAt ? `${reason ? ' · ' : ''}Signed${vo.signedName ? ` by ${vo.signedName}` : ''} ${fmtDate(vo.signedAt)}` : ''}
      </p>
      {fixes.length > 0 && (
        <p>{fixes.map((f) => `${f.poNumber ?? 'PO'} ${f.action === 'CANCEL' ? 'cancel line' : `change qty to ${f.newQty ?? '—'}`}`).join(' · ')}</p>
      )}
    </div>
  );
};
