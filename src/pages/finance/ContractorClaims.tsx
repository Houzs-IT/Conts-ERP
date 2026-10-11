import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { MoneyText, moneyString } from '../../components/MoneyText';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/States';
import { Card } from '../../components/Card';
import { StatRow, StatTile } from '../../components/Metric';
import { useApi } from '../../lib/useApi';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { date as fmtDate, count, titleCase, todayMyt } from '../../lib/format';
import { useUrlState, SearchBox } from './listKit';

/** Accounts payable > Contractor claims: what each maintenance job owes its technician or contractor (entered on the
 *  job) and the day accounts paid it. Finance marks it paid here (POST /api/finance/payables). */

interface Claim {
  id: string; title: string; state: string; payee: string | null; payeeKind: string | null; chargeTo: string | null;
  billingDate: string | null; finishedAt: string | null; amount: number; paidOn: string | null;
  unitId: string; unitNumber: string; propertyName: string;
}
interface Payload { ready: boolean; data: Claim[]; counts: { unpaid: number; paid: number }; owed: number }
type Paid = 'no' | 'yes' | 'all';

const unitOf = (c: Claim) => `${c.propertyName} ${c.unitNumber}`;
const billedOn = (c: Claim) => c.billingDate ?? c.finishedAt?.slice(0, 10) ?? null;

export default function ContractorClaims() {
  const url = useUrlState();
  const toast = useToast();
  const paid: Paid = url.get('paid') === 'yes' ? 'yes' : url.get('paid') === 'all' ? 'all' : 'no';
  const q = url.get('q');
  const { data, loading, error, reload } = useApi<Payload>(`/finance/payables?${new URLSearchParams({ paid, ...(q ? { q } : {}) })}`);
  const [confirm, setConfirm] = useState<{ c: Claim; to: 'paid' | 'unpaid' } | null>(null);
  const [busy, setBusy] = useState(false);

  async function record(c: Claim, to: 'paid' | 'unpaid') {
    setBusy(true);
    try {
      await api.post('/finance/payables', { maintenanceId: c.id, paidOn: to === 'paid' ? todayMyt() : null });
      setConfirm(null);
      reload();
      toast(to === 'paid'
        ? { tone: 'success', title: 'Recorded as paid.', body: `${titleCase(c.payee ?? 'The contractor')}: ${moneyString(c.amount, 'exact')} for ${c.title}.` }
        : { tone: 'success', title: 'Back to not paid.', body: `${c.title}: the paid date was cleared.` });
    } catch (e) {
      toast({ tone: 'critical', title: 'The payment was not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const columns = useMemo<Column<Claim>[]>(() => [
    { key: 'job', label: 'Maintenance job', value: c => c.title, hideable: false, width: 260, sub: c => unitOf(c),
      render: c => <span className="font-medium block truncate" title={c.title}>{c.title}</span> },
    { key: 'unit', label: 'Unit', value: c => unitOf(c), hidden: true, width: 180 },
    { key: 'payee', label: 'Pay to', value: c => c.payee ? titleCase(c.payee) : null, width: 180 },
    { key: 'billed', label: 'Billed on', type: 'date', value: c => billedOn(c), width: 120 },
    { key: 'amount', label: 'Owed', type: 'money', value: c => c.amount, width: 130,
      render: c => <MoneyText sen={c.amount} mode="exact" strong className="text-copy" /> },
    { key: 'status', label: 'Status', type: 'status', value: c => (c.paidOn ? 'paid' : 'unpaid'), text: c => (c.paidOn ? `Paid · ${fmtDate(c.paidOn)}` : 'Not paid'), width: 160,
      render: c => c.paidOn ? <StatusBadge tone="success" label={`Paid · ${fmtDate(c.paidOn)}`} /> : <StatusBadge tone="warning" label="Not paid" /> },
    { key: 'action', label: '', width: 130, align: 'right', noExport: true, sortable: false, filter: false, hideable: false,
      render: c => (
        <span className="flex justify-end" onClick={e => e.stopPropagation()}>
          {c.paidOn
            ? <Button size="sm" variant="tertiary" onClick={() => setConfirm({ c, to: 'unpaid' })}>Mark not paid</Button>
            : <Button size="sm" variant="secondary" onClick={() => setConfirm({ c, to: 'paid' })}>Mark paid</Button>}
        </span>
      ) },
  ], []);

  if (data && !data.ready) {
    return <Card><EmptyState bare title="Contractor claims are not set up on this database yet." body="They need a database update (migration 0108). Bills are on the Bills tab." /></Card>;
  }

  const spec: ConfirmSpec | null = !confirm ? null : confirm.to === 'paid' ? {
    title: `Mark ${moneyString(confirm.c.amount, 'exact')} to ${titleCase(confirm.c.payee ?? 'the contractor')} as paid?`,
    body: 'Only once the money has left the bank. Records today as the day it was paid; the maintenance job shows it too.',
    meta: `${confirm.c.title} · ${unitOf(confirm.c)}`,
    danger: true, confirmLabel: 'Mark paid', busyLabel: 'Saving...', onConfirm: () => record(confirm.c, 'paid'),
  } : {
    title: 'Mark this claim as not paid?',
    body: 'Clears the paid date, for a payment recorded by mistake.',
    meta: `${moneyString(confirm.c.amount, 'exact')} · ${confirm.c.title}`,
    confirmLabel: 'Mark not paid', busyLabel: 'Saving...', onConfirm: () => record(confirm.c, 'unpaid'),
  };

  return (
    <>
      <StatRow cols={3}>
        <StatTile className="col-span-2 sm:col-span-1" hero label="Owed to contractors" value={data ? moneyString(data.owed, 'exact') : undefined} />
        <StatTile label="Not paid" value={data ? count(data.counts.unpaid) : undefined} />
        <StatTile label="Paid" value={data ? count(data.counts.paid) : undefined} />
      </StatRow>
      <DataTable<Claim>
        id="payables.claims" columns={columns} rows={data ? data.data : null} rowKey={c => c.id}
        loading={loading} error={error} onRetry={reload} pageSize={50}
        viewParams={['paid', 'q']} filtered={!!q} onClearFilters={() => url.set({ q: null })}
        noun={['claim', 'claims']} exportName="contractor-claims"
        empty={{ title: paid === 'no' ? 'Nothing owed to contractors.' : 'No contractor claims here.', body: 'A claim appears when the amount owed to the technician or contractor is entered on a maintenance job.' }}
        header={
          <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <FilterBar<Paid> label="Paid or not" value={paid} onChange={k => url.set({ paid: k === 'no' ? null : k })}
              views={[
                { key: 'no', label: 'Not paid', count: data?.counts.unpaid },
                { key: 'yes', label: 'Paid', count: data?.counts.paid },
                { key: 'all', label: 'All', count: data ? data.counts.unpaid + data.counts.paid : undefined },
              ]} />
          </div>
        }
        toolbar={<SearchBox className="flex-[1_1_260px] max-w-[420px]" label="Search claims" placeholder="Search job, contractor or unit" value={q} onChange={v => url.set({ q: v || null })} />}
        renderCard={c => (
          <span className="flex items-start gap-3 text-ink">
            <span className="flex flex-col gap-[3px] min-w-0 flex-1">
              <span className="text-copy font-medium truncate">{c.title}</span>
              <span className="text-meta text-muted-ink truncate">{unitOf(c)}{c.payee ? ` · ${titleCase(c.payee)}` : ''}</span>
            </span>
            <span className="flex flex-col items-end gap-[5px] shrink-0">
              <MoneyText sen={c.amount} mode="exact" strong className="text-copy" />
              {c.paidOn ? <StatusBadge tone="success" label="Paid" size="sm" /> : <StatusBadge tone="warning" label="Not paid" size="sm" />}
            </span>
          </span>
        )}
      />
      <ConfirmDialog spec={spec} busy={busy} onClose={() => { if (!busy) setConfirm(null); }} />
    </>
  );
}
