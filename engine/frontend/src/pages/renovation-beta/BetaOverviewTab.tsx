/* Beta workspace > Overview: payments, what needs doing, site and design progress, the key, the sales order. */

import { Link } from "react-router-dom";
import { FileText, HardHat, ListChecks, Ruler, Wallet } from "lucide-react";
import { Button } from "../../components/Button";
import { cn } from "../../lib/utils";
import { Card, KeyCard } from "../projects/renovation/ProjectRecords";
import { TASK_STATUS_LABEL, money, shortDate, taskTone, type Tone } from "../projects/renovation/renovationModel";
import { Pill, smallBtn } from "../projects/renovation/renovationUi";
import type { ReactElement } from "react";
import { sendReminder, useGuarded, type BetaTabProps } from "./betaShared";
import type { BetaInstalment } from "./renovationBetaApi";
import { designProgress, paymentStrip, siteProgress, todoList, type DesignRow, type TodoRow } from "./renovationBetaModel";

const PAY_TONE: Record<BetaInstalment["status"], Tone> = { paid: "ok", billed: "warn", not_billed: "muted" };

export function BetaOverviewTab(p: BetaTabProps): ReactElement {
  const { detail: d, workspace, records, today } = p;
  const todo = todoList({
    today,
    projectName: d.project.name,
    customerName: d.project.customer_name,
    customerPhone: d.project.customer_phone,
    currentStage: d.currentStage,
    files: records.files,
    measures: records.measures,
    workspace,
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <PaymentsCard payments={workspace.payments} />
        <TodoCard rows={todo} p={p} />
        <SiteCard tasks={d.tasks} />
        <DesignCard rows={designProgress(records.files, records.measures, workspace, today)} />
      </div>
      <aside className="min-w-0 space-y-4">
        <KeyCard d={d} canWrite={p.canWrite} onDone={p.onDone} onError={p.onError} />
        <OrderCard p={p} />
      </aside>
    </div>
  );
}

function PaymentsCard({ payments }: { payments: BetaTabProps["workspace"]["payments"] }) {
  const strip = paymentStrip(payments);
  return (
    <Card title="Payments" icon={<Wallet size={14} />}>
      {payments.state === "hidden" && <p className="text-sm text-ink-secondary">Payment figures are hidden for your role.</p>}
      {payments.state === "none" && <p className="text-sm text-ink-secondary">No sales order yet, or billing is not available. Nothing to show.</p>}
      {strip && (
        <>
          <p className="text-sm text-ink-secondary">
            Received <span className="font-medium text-ink tabular-nums">{money(strip.receivedSen)}</span> of <span className="tabular-nums">{money(strip.contractSen)}</span>
            {strip.receivedPct != null && ` (${strip.receivedPct}%)`}
          </p>
          {strip.rows.length === 0 ? <p className="mt-2 text-sm text-ink-secondary">The sales order has no instalments.</p> : (
            <ol aria-label="Instalments" className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {strip.rows.map((r) => (
                <li key={r.seq} className="min-w-0 rounded-md border border-border bg-surface-dim p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">{r.seq}. {r.label}</span>
                    <Pill tone={PAY_TONE[r.status]}>{r.statusLabel}</Pill>
                  </div>
                  <div className="mt-1 text-sm tabular-nums text-ink">{money(r.amountSen)}</div>
                  {r.status === "billed" && r.paidSen > 0 && <div className="text-xs text-ink-secondary">Paid so far {money(r.paidSen)}</div>}
                  <div className="mt-1 text-xs text-ink-secondary">{r.unlocks ? `Unlocks: ${r.unlocks}` : "Not tied to a step"}</div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}

function TodoCard({ rows, p }: { rows: TodoRow[]; p: BetaTabProps }) {
  const { busy, run } = useGuarded();
  return (
    <Card title="To do" icon={<ListChecks size={14} />}>
      {rows.length === 0 ? <p className="text-sm text-ink-secondary">Nothing needs attention right now.</p> : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const { action } = r;
            return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium [overflow-wrap:anywhere]", r.tone === "err" ? "text-err" : "text-ink")}>{r.title}</div>
                {r.detail && <div className="text-xs text-ink-secondary [overflow-wrap:anywhere]">{r.detail}</div>}
              </div>
              {action.type === "open" ? (
                <Button variant="secondary" className={smallBtn} onClick={() => p.openTab(action.tab)}>{action.label}</Button>
              ) : p.canWrite && (
                <Button variant="secondary" className={smallBtn} disabled={busy} onClick={() => void run(() => sendReminder(p.projectId, action, p.onDone, p.onError))}>
                  {action.label}
                  <span className="sr-only">: {r.title}</span>
                </Button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SiteCard({ tasks }: { tasks: BetaTabProps["detail"]["tasks"] }) {
  const s = siteProgress(tasks);
  const shown = s.open.slice(0, 5);
  return (
    <Card title="Site progress" icon={<HardHat size={14} />}>
      {s.total === 0 ? <p className="text-sm text-ink-secondary">No site tasks yet.</p> : (
        <>
          <p className="text-sm text-ink-secondary">
            <span className="font-medium text-ink">{s.done} of {s.total}</span> site tasks done
            {s.late > 0 && <span className="text-err"> · {s.late} late</span>}
          </p>
          <div role="progressbar" aria-label="Site tasks done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.pct} className="mt-1 h-2 overflow-hidden rounded-full bg-surface-dim">
            <div className="h-full bg-primary" style={{ width: `${s.pct}%` }} />
          </div>
          {shown.length > 0 && (
            <ul className="mt-3 divide-y divide-border">
              {shown.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{t.label}</span>
                  <span className="flex items-center gap-2 text-xs text-ink-secondary">
                    {t.planned_end && <span>by {shortDate(t.planned_end)}</span>}
                    <Pill tone={taskTone(t.status)}>{TASK_STATUS_LABEL[t.status]}</Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.open.length > shown.length && <p className="mt-1 text-xs text-ink-secondary">and {s.open.length - shown.length} more</p>}
        </>
      )}
    </Card>
  );
}

function DesignCard({ rows }: { rows: DesignRow[] }) {
  return (
    <Card title="Design progress" icon={<Ruler size={14} />}>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
            <span className="font-medium text-ink">{r.label}{r.version && <span className="font-normal text-ink-secondary"> · {r.version}</span>}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
              {r.due && <span className={cn(r.daysLeft != null && r.daysLeft < 0 && "text-err")}>
                Due {shortDate(r.due)}{r.daysLeft != null && ` (${r.daysLeft < 0 ? `${-r.daysLeft} days late` : r.daysLeft === 0 ? "today" : `${r.daysLeft} days left`})`}
              </span>}
              {r.state === "done" && r.doneOn && <span>{r.kind === "onsite" ? "Measured" : "Approved"} {shortDate(r.doneOn)}</span>}
              <Pill tone={r.state === "done" ? "ok" : r.state === "waiting" ? "warn" : "muted"}>
                {r.state === "done" ? (r.kind === "onsite" ? "Measured" : "Approved") : r.state === "waiting" ? "Waiting for client" : r.kind === "onsite" ? "Not measured" : "Open"}
              </Pill>
            </span>
          </li>
        ))}
      </ul>
      {rows.every((r) => r.due == null) && <p className="mt-2 text-xs text-ink-secondary">Deadlines start counting once the first site measure is recorded.</p>}
    </Card>
  );
}

function OrderCard({ p }: { p: BetaTabProps }) {
  const { detail: d } = p;
  const attending = d.people.attending.map((a) => a.name).join(", ");
  return (
    <Card title="Sales order and team" icon={<FileText size={14} />}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-ink-secondary">Sales order</dt>
          <dd>{d.so
            ? <><Link className="text-primary" to={`/scm/renovation/sales-orders/${encodeURIComponent(d.so.doc_no)}`}>{d.so.doc_no}</Link><span className="text-ink-secondary"> · {shortDate(d.so.so_date)}</span></>
            : <span className="text-ink-secondary">Not signed yet</span>}</dd>
        </div>
        <div><dt className="text-xs text-ink-secondary">Customer</dt><dd className="[overflow-wrap:anywhere]">{d.project.customer_name ?? "-"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Phone</dt><dd>{d.project.customer_phone ?? "-"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Designer</dt><dd>{d.people.designer.name ?? "-"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Sales</dt><dd>{d.people.sales.name ?? "-"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Project PIC</dt><dd>{d.people.pic.name ?? d.people.renoPic.name ?? "-"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Attending</dt><dd className="[overflow-wrap:anywhere]">{attending || "-"}</dd></div>
      </dl>
    </Card>
  );
}
