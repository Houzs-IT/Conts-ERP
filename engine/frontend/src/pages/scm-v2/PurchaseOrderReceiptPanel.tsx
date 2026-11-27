import type { ReactElement } from 'react';
import { fmtMoneySen } from '@2990s/shared';
import styles from './SalesOrderDetail.module.css';
import layout from './PurchaseOrderLayout.module.css';

export interface PoReceiptLine {
  rid: string;
  itemCode: string;
  description: string;
  qty: number;
  lineTotalSen: number;
}

export interface PoReceiptMeta {
  creditorLabel: string | null;
  poDate: string;
  expectedAt: string;
  purchaseLocationLabel: string | null;
  currency: string;
}

export interface PoReceiptTotals {
  totalUnits: number;
  grossSen: number;
  discountSen: number;
  netSen: number;
}

export interface PurchaseOrderReceiptPanelProps {
  meta: PoReceiptMeta;
  lines: PoReceiptLine[];
  totals: PoReceiptTotals;
}

const LABEL_STYLE = {
  fontFamily: 'var(--font-button)',
  fontSize: 'var(--fs-11)',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
} as const;

const MetaRow = ({ label, value }: { label: string; value: string | null }): ReactElement => (
  <div className="flex items-baseline justify-between gap-3 text-[length:var(--fs-13)]">
    <span className="shrink-0 text-[color:var(--fg-muted)]">{label}</span>
    <span className="min-w-0 truncate text-right font-medium" title={value ?? undefined}>{value || 'Not set'}</span>
  </div>
);

const TotalRow = ({ label, value, isStrong = false }: { label: string; value: string; isStrong?: boolean }): ReactElement => (
  <div className={`flex items-baseline justify-between gap-3 ${isStrong ? 'text-base font-bold' : 'text-[length:var(--fs-13)]'}`}>
    <span>{label}</span>
    <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
  </div>
);

export const PurchaseOrderReceiptPanel = ({ meta, lines, totals }: PurchaseOrderReceiptPanelProps): ReactElement => {
  const money = (sen: number): string => fmtMoneySen(sen, meta.currency);

  return (
    <aside
      aria-label="Order summary"
      className={`${styles.card} ${layout.receipt} flex flex-col`}
    >
      <div className="shrink-0 space-y-2 p-4">
        <h2 className={styles.cardTitle}>Order TL;DR</h2>
        <MetaRow label="Creditor" value={meta.creditorLabel} />
        <MetaRow label="PO date" value={meta.poDate} />
        <MetaRow label="Expected delivery" value={meta.expectedAt} />
        <MetaRow label="Purchase location" value={meta.purchaseLocationLabel} />
        <MetaRow label="Currency" value={meta.currency} />
      </div>

      {/* Phone and tablet already list every line in full right above this card. */}
      <div className={`${layout.receiptItems} min-h-0 flex-1 flex-col border-t border-[rgb(var(--eng-border))]`}>
        <div className="shrink-0 px-4 pb-2 pt-3" style={LABEL_STYLE}>Items summary ({lines.length})</div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-2 pl-4 pr-1">
          {lines.length === 0 && (
            <li className="py-2 text-[length:var(--fs-13)] text-[color:var(--fg-muted)]">No lines yet.</li>
          )}
          {lines.map((line) => (
            <li key={line.rid} className="border-b border-[rgb(var(--eng-border))] py-2 pr-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3 text-[length:var(--fs-13)]">
                <span className="min-w-0 truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                  {line.qty} × {line.itemCode || 'No item'}
                </span>
                <span className="shrink-0 tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>{money(line.lineTotalSen)}</span>
              </div>
              <div className="truncate text-[length:var(--fs-12)] text-[color:var(--fg-muted)]" title={line.description || undefined}>
                {line.description || 'No description'}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-[rgb(var(--eng-border))] p-4">
        <TotalRow label="Total Lines" value={String(lines.length)} />
        <TotalRow label="Total Units" value={String(totals.totalUnits)} />
        <TotalRow label="Subtotal" value={money(totals.grossSen)} />
        <TotalRow label="Total Discount" value={money(totals.discountSen)} />
        <div className="border-t border-[rgb(var(--eng-border))] pt-2">
          <TotalRow label={`Total (${meta.currency})`} value={money(totals.netSen)} isStrong />
        </div>
      </div>
    </aside>
  );
};
