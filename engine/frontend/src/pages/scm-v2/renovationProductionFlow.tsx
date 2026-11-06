/* Where a production order stands, across the top of its page (owner, 6 Nov 2026): one row from issued to delivered, so
   the job's next step reads without going through the cards. */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { fmtDate } from '@2990s/shared';
import { cn } from '../../lib/utils';
import { useMaterialStatus, useProductionMaterials } from '../../vendor/scm/lib/production-order-queries';

type StepState = 'done' | 'now' | 'next';
interface Step { label: string; detail: ReactNode; state: StepState }

function FlowStep({ step, n, last }: { step: Step; n: number; last: boolean }) {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold',
        step.state === 'done' ? 'border-synced bg-synced text-white'
          : step.state === 'now' ? 'border-accent bg-accent-soft text-accent-ink'
            : 'border-border bg-surface text-ink-muted',
      )}>
        {step.state === 'done' ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] font-semibold', step.state === 'next' ? 'text-ink-muted' : 'text-ink')}>{step.label}</div>
        <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{step.detail}</div>
      </div>
      {!last && <span aria-hidden className="mt-3 hidden h-px w-6 shrink-0 bg-border sm:block" />}
    </li>
  );
}

export function ProductionFlow({ orderId, status, issuedAt, completedAt, grn, deliveryOrder }: {
  orderId: string;
  status: string;
  issuedAt: string | null | undefined;
  completedAt: string | null | undefined;
  grn: { id: string; grn_number: string } | null | undefined;
  deliveryOrder: { id: string; do_number: string } | null | undefined;
}) {
  const materials = useProductionMaterials(orderId).data ?? [];
  const statuses = useMaterialStatus(orderId).data;
  const received = materials.filter((m) => statuses?.[m.id]?.state === 'received').length;
  const complete = status === 'RECEIVED';
  const issued = complete || status === 'SUBMITTED' || status === 'PARTIALLY_RECEIVED';
  const materialsDone = complete || (materials.length > 0 && received === materials.length);

  const steps: Step[] = [
    { label: 'Issued', detail: issuedAt ? fmtDate(issuedAt) : 'Not issued yet', state: issued ? 'done' : 'now' },
    {
      label: 'Raw materials',
      detail: materials.length === 0 ? 'None on this order' : `${received} of ${materials.length} received`,
      state: materialsDone || (issued && materials.length === 0) ? 'done' : issued ? 'now' : 'next',
    },
    { label: 'Complete', detail: completedAt ? fmtDate(completedAt) : 'Not yet', state: complete ? 'done' : issued ? 'now' : 'next' },
    {
      label: 'Goods receipt',
      detail: grn ? <Link className="text-primary hover:underline" to={`/scm/grns/${grn.id}`}>{grn.grn_number}</Link> : 'Raised on Complete',
      state: grn ? 'done' : 'next',
    },
    {
      label: 'Delivery order',
      detail: deliveryOrder ? <Link className="text-primary hover:underline" to={`/scm/delivery-orders/${deliveryOrder.id}`}>{deliveryOrder.do_number}</Link> : 'Raised on Complete',
      state: deliveryOrder ? 'done' : 'next',
    },
  ];
  return (
    <ol aria-label="Progress" className="mb-3 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-stone sm:grid-cols-2 lg:flex lg:gap-2">
      {steps.map((s, i) => <FlowStep key={s.label} step={s} n={i + 1} last={i === steps.length - 1} />)}
    </ol>
  );
}
