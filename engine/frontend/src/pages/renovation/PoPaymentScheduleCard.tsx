// Payment schedule of a purchase order raised for renovation work: the
// instalments (default Mobilise 30 / Completion 65 / Retention 5), whether each
// is payable now, what was paid against it, and the release of retention.
// Shown on the Purchase Order page; a PO with no schedule can take the default.

import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { refusalOf, renoSend, usePoSchedule, useRenoMutation, type PoSchedule } from '../../lib/renovation/api';
import { Card, ErrorBanner, Field, fmtDate, inputCls, MoneyInput, pctLabel, rm, todayIso } from './shared';
import { cn } from '../../lib/utils';

const PAYABLE_LABEL: Record<string, string> = { ON_CONFIRM: 'on confirm', ON_RECEIPT: 'on receipt', ON_HANDOVER: 'after handover', MANUAL: 'on release' };

type Inst = PoSchedule['instalments'][number];

function PayDialog({ inst, onClose }: { inst: Inst | null; onClose: () => void }) {
  const [amount, setAmount] = useState<number>(inst?.outstandingSen ?? 0);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pay = useRenoMutation(() => renoSend(`/po-instalments/${inst!.id}/payments`, 'POST', { amountSen: amount, paidOn, note }));
  if (!inst) return null;
  return (
    <ModalOverlay open onClose={onClose} title={`Record payment · ${inst.label}`} icon={<Wallet size={16} />}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pay.isPending} onClick={async () => { setError(null); try { await pay.mutateAsync(undefined); onClose(); } catch (e) { setError(refusalOf(e).message); } }}>{pay.isPending ? 'Saving…' : 'Record'}</Button></div>}>
      <div className="space-y-3">
        <p className="text-[13px] text-ink-secondary">Outstanding {rm(inst.outstandingSen)} of {rm(inst.amountSen)}.</p>
        <Field label="Amount"><MoneyInput value={amount} onChange={(v) => setAmount(v ?? 0)} /></Field>
        <Field label="Paid on"><input type="date" className={inputCls} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Note (e.g. payment voucher number)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}

export function PoPaymentScheduleCard({ poId, offerDefault = false }: { poId: string; offerDefault?: boolean }) {
  const s = usePoSchedule(poId);
  const { can } = useAuth();
  const [paying, setPaying] = useState<Inst | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await act.mutateAsync(fn); } catch (e) { setError(refusalOf(e).message); } };
  if (s.isLoading) return null;
  if (s.error) return null; // a non-renovation engine without the schedule tables: no card
  const data = s.data!;
  if (data.instalments.length === 0) {
    if (!offerDefault || !can('scm.renovation.po_split')) return null;
    return (
      <Card title="Payment schedule">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-secondary">
          <span>No payment schedule on this PO.</span>
          <Button variant="secondary" onClick={() => run(() => renoSend(`/purchase-orders/${poId}/schedule/default`, 'POST', {}))}>Add default schedule</Button>
        </div>
        <ErrorBanner error={error} />
      </Card>
    );
  }
  return (
    <Card title="Payment schedule" dense actions={<span className="text-[12.5px] text-ink-secondary">Paid {rm(data.totals.paidSen)} of {rm(data.totals.scheduledSen)} · payable now {rm(data.totals.payableNowSen)}</span>}>
      {error && <div className="p-3"><ErrorBanner error={error} /></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[12.5px]">
          <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-1.5">Instalment</th><th className="text-right">%</th><th className="text-right">Amount</th><th className="pl-4">Payable</th><th className="text-right">Paid</th><th className="px-3" /></tr>
          </thead>
          <tbody>
            {data.instalments.map((i) => (
              <tr key={i.id} className="border-t border-border-subtle align-top">
                <td className="px-3 py-2 font-semibold">{i.label}{i.payments.map((p) => <div key={p.id} className="text-[11px] font-normal text-ink-muted">{fmtDate(p.paidOn)} · {rm(p.amountSen)}{p.pvNumber ? ` · ${p.pvNumber}` : p.note ? ` · ${p.note}` : ''}</div>)}</td>
                <td className="py-2 text-right tabular-nums">{pctLabel(i.pctBp)}</td>
                <td className="py-2 text-right tabular-nums">{rm(i.amountSen)}</td>
                <td className="py-2 pl-4">
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', i.payable ? 'bg-synced-bg text-synced' : 'bg-surface-2 text-ink-muted')}>{i.payable ? 'payable' : `not yet (${PAYABLE_LABEL[i.payableOn]})`}</span>
                  {i.releasedAt && <div className="text-[11px] text-ink-muted">released {fmtDate(i.releasedAt)}{i.releaseNote ? `: ${i.releaseNote}` : ''}</div>}
                  {i.payableOn === 'ON_HANDOVER' && !i.payable && data.handover === 'unknown' && <div className="text-[11px] text-ink-muted">handover not recorded yet</div>}
                </td>
                <td className="py-2 text-right tabular-nums">{rm(i.paidSen)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {!i.payable && !i.releasedAt && (i.payableOn === 'MANUAL' || i.payableOn === 'ON_HANDOVER') && can('scm.renovation.bill') && (
                      <Button variant="secondary" className="h-8" onClick={() => { const note = window.prompt(`Release ${i.label}: why (e.g. handover signed, snag list closed)?`); if (note) void run(() => renoSend(`/po-instalments/${i.id}/release`, 'POST', { note })); }}>Release</Button>
                    )}
                    {i.payable && i.outstandingSen > 0 && can('scm.renovation.bill') && <Button className="h-8" onClick={() => setPaying(i)}>Record payment</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PayDialog key={paying?.id ?? "none"} inst={paying} onClose={() => setPaying(null)} />
    </Card>
  );
}
