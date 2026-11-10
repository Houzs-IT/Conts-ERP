// "Update prices from invoices" on a supplier's SKU mappings (TODO port item 11,
// after Hookka 5957bdd87 + 6801df6fb). Lists each mapping whose latest accepted
// purchase invoice charged a different price, ticked by default; jumps that look
// like a box vs piece mix-up and other refusals are listed apart for a person to
// check, never applied. Apply re-checks on the server.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/Button';
import {
  useApplySupplierPriceRefresh,
  useSupplierPriceRefresh,
  type PriceDrift,
} from '../../vendor/scm/lib/suppliers-queries';
import { fmtSen } from '../../vendor/shared/format';
import styles from './SupplierDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* "+10.0%" / "-4.5%"; blank when the list had no price. */
export function changePct(d: Pick<PriceDrift, 'listSen' | 'paidSen'>): string {
  if (!d.listSen || d.paidSen == null) return '';
  const pct = ((d.paidSen - d.listSen) / d.listSen) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

const cell = { padding: '4px 6px', fontSize: 'var(--fs-12)', borderBottom: '1px solid #e4e6e1' } as const;

export function SupplierPriceRefreshDialog({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const plan = useSupplierPriceRefresh(supplierId, true);
  const apply = useApplySupplierPriceRefresh();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const changes = plan.data?.changes ?? [];
  useEffect(() => { setPicked(new Set(changes.map((c) => c.bindingId))); }, [plan.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async () => {
    try {
      const res = await apply.mutateAsync({ supplierId, bindingIds: [...picked] });
      setSummary(`${res.updated} price${res.updated === 1 ? '' : 's'} updated${res.failed.length ? ` · ${res.failed.length} not updated: ${res.failed.map((f) => `${f.itemCode || f.bindingId} (${f.reason})`).join('; ')}` : ''}`);
    } catch (e) {
      setSummary(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const worklist = [...(plan.data?.unitMismatches ?? []), ...(plan.data?.refused ?? [])];
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} style={{ width: 'min(760px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Update prices from invoices</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X {...ICON} /></button>
        </header>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 'var(--fs-12)', color: '#767b6e', marginBottom: 'var(--space-3)' }}>
            Each item's price is compared with the latest posted purchase invoice from this supplier (the price after the
            line's discount). The new price takes effect from that invoice's date, so the next PO copies what was actually
            paid. A jump of more than 3x, an invoice in another unit or with no unit, or an item with no list price yet, is not
            applied: it is usually a box vs piece mix-up. Nothing changes until you press Update.
          </p>
          {plan.isLoading && <p style={{ fontSize: 'var(--fs-13)' }}>Checking invoices…</p>}
          {plan.error && <p style={{ fontSize: 'var(--fs-13)', color: '#b3261e' }}>{(plan.error as Error).message}</p>}
          {plan.data && (
            <>
              <p style={{ fontSize: 'var(--fs-13)', fontWeight: 700 }}>
                {changes.length} to update · {plan.data.current} already current
                {worklist.length > 0 && <> · <span style={{ color: '#b3261e' }}>{worklist.length} to check</span></>}
              </p>
              {changes.length > 0 && (
                <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 'var(--space-2)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={cell} />
                        <th style={{ ...cell, textAlign: 'left' }}>Item</th>
                        <th style={{ ...cell, textAlign: 'right' }}>Price list</th>
                        <th style={{ ...cell, textAlign: 'right' }}>Paid</th>
                        <th style={{ ...cell, textAlign: 'right' }}>Change</th>
                        <th style={{ ...cell, textAlign: 'left' }}>Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((d) => (
                        <tr key={d.bindingId}>
                          <td style={cell}><input type="checkbox" checked={picked.has(d.bindingId)} onChange={() => toggle(d.bindingId)} aria-label={`Update ${d.itemCode}`} /></td>
                          <td style={cell}><span className="font-money">{d.itemCode}</span> {d.materialName}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{fmtSen(d.listSen)}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{fmtSen(d.paidSen)}</td>
                          <td style={{ ...cell, textAlign: 'right', color: d.deltaSen > 0 ? '#b3261e' : '#2F5D4F' }}>{changePct(d)}</td>
                          <td style={cell}>{d.invoiceNumber ?? ''} · {d.paidOn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {worklist.length > 0 && (
                <>
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-12)', fontWeight: 600 }}>To check (not updated)</div>
                  <ul style={{ maxHeight: 180, overflowY: 'auto', paddingLeft: 'var(--space-4)', fontSize: 'var(--fs-12)', color: '#4b5045' }}>
                    {worklist.map((d) => (
                      <li key={d.bindingId}>
                        <span className="font-money">{d.itemCode}</span>{d.invoiceNumber ? ` (${d.invoiceNumber}, ${d.paidOn})` : ''}: {d.whyNot}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {summary && <p style={{ fontSize: 'var(--fs-13)', marginTop: 'var(--space-2)' }}>{summary}</p>}
        </div>
        <footer className={styles.modalFooter}>
          <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>{summary ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void run()} disabled={apply.isPending || picked.size === 0 || !!summary}>
            {apply.isPending ? 'Updating…' : `Update ${picked.size} price${picked.size === 1 ? '' : 's'}`}
          </Button>
        </footer>
      </div>
    </div>
  );
}
