import { useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

/** Accounting — AP (owed to suppliers, from purchase invoices) + AR (owed by customers,
 *  from sales invoices), ported from 2990's SCM. Read-only, finance-gated. Ties the two
 *  ledgers together. Aging buckets are a follow-up. */

interface Payable { code: string; name: string; outstandingSen: number; invoices: number; overdue: number }
interface Receivable { name: string; outstandingSen: number; invoices: number; overdue: number }
interface Payload { payables: Payable[]; receivables: Receivable[]; apTotalSen: number; arTotalSen: number; restricted?: boolean; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  payables: [
    { code: 'SUP-HILTON', name: 'Hilton Bedding Manufacturing', outstandingSen: 220000, invoices: 1, overdue: 0 },
    { code: 'SUP-NORDIC', name: 'Nordic Woodcraft', outstandingSen: 378000, invoices: 1, overdue: 0 },
  ],
  receivables: [
    { name: 'Vista Jaya Residences', outstandingSen: 684000, invoices: 1, overdue: 0 },
  ],
  apTotalSen: 598000, arTotalSen: 684000,
};

export default function AccountingPage() {
  const { data, loading, error, reload } = useApi<Payload>('/accounting', FALLBACK);
  const [tab, setTab] = useState<'ap' | 'ar'>('ap');
  const d = data ?? FALLBACK;
  const net = d.arTotalSen - d.apTotalSen;

  if (d.restricted) return (<><PageHeader title="Accounting" sub="Payables and receivables" /><Card><div className="py-[38px] px-[22px] text-center text-[13px] text-muted-ink">Accounting figures are visible to finance roles only.</div></Card></>);

  return (
    <>
      <PageHeader title="Accounting" sub="Payables and receivables · outstanding" />
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Stat label="Payables (AP)" value={rm(d.apTotalSen, { cents: false })} hint="Owed to suppliers" tone="warning" />
        <Stat label="Receivables (AR)" value={rm(d.arTotalSen, { cents: false })} hint="Owed by customers" tone="info" />
        <Stat label="Net position" value={rm(net, { cents: false })} hint={net >= 0 ? 'Receivables exceed payables' : 'Payables exceed receivables'} tone={net >= 0 ? 'success' : 'critical'} />
      </div>

      <div className="flex gap-2">
        <Chip label={`Payables (${d.payables.length})`} active={tab === 'ap'} onClick={() => setTab('ap')} />
        <Chip label={`Receivables (${d.receivables.length})`} active={tab === 'ar'} onClick={() => setTab('ar')} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          {tab === 'ap' ? (
            <table className="w-full border-collapse min-w-[560px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Supplier', 'Open invoices', 'Overdue', 'Outstanding'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i >= 1 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={4}><TableSkeleton rows={4} cols={4} /></td></tr>
                : d.payables.length === 0 ? <tr><td colSpan={4}><div className="py-[38px] text-center text-[14px] font-semibold">Nothing owed to suppliers.</div></td></tr>
                : d.payables.map(p => (
                  <tr key={p.code} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[13px] px-4"><div className="flex flex-col"><span className="text-[13.5px]">{p.name}</span><span className="text-[11.5px] text-muted-ink">{p.code}</span></div></td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{p.invoices}</td>
                    <td className={cx('py-[13px] px-4 text-right tabular-nums text-[13px]', p.overdue ? 'text-[var(--color-critical-fg)] font-semibold' : 'text-muted-ink')}>{p.overdue || '—'}</td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{rm(p.outstandingSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse min-w-[560px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Customer', 'Open invoices', 'Overdue', 'Outstanding'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i >= 1 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={4}><TableSkeleton rows={4} cols={4} /></td></tr>
                : d.receivables.length === 0 ? <tr><td colSpan={4}><div className="py-[38px] text-center text-[14px] font-semibold">Nothing owed by customers.</div></td></tr>
                : d.receivables.map(r => (
                  <tr key={r.name} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[13px] px-4 text-[13.5px]">{r.name}</td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{r.invoices}</td>
                    <td className={cx('py-[13px] px-4 text-right tabular-nums text-[13px]', r.overdue ? 'text-[var(--color-critical-fg)] font-semibold' : 'text-muted-ink')}>{r.overdue || '—'}</td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{rm(r.outstandingSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'warning' | 'info' | 'success' | 'critical' }) {
  return (
    <div className="flex flex-col gap-[3px] py-[13px] px-[15px] rounded-card bg-card border border-solid border-line">
      <span className={cx('text-[19px] font-semibold tabular-nums', TONE[tone].text)}>{value}</span>
      <span className="text-[12px] font-medium">{label}</span>
      <span className="text-[11px] text-muted-ink">{hint}</span>
    </div>
  );
}
