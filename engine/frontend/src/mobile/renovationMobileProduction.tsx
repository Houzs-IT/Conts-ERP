/* A production order on the phone (owner, 6 Nov 2026): what a worker on site needs, plan first, raw materials and the day's
   photos, with one thumb action at the bottom. The dialogs, the day strip and the press logic are the desktop page's own
   (pages/scm-v2/renovationProductionParts.tsx), so the two screens cannot disagree. */

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { fmtDate, fmtMoneySen, fmtQty } from "@2990s/shared";
import { Button } from "../components/Button";
import { ModalOverlay } from "../components/scm-v2/DocumentRelationshipMapModal";
import { PhotoAddButtons, PhotoUploads } from "../components/PhotoAdd";
import { cn } from "../lib/utils";
import { useAuth } from "../auth/AuthContext";
import { canOperateProductionOrders } from "../auth/salesAccess";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useNotify } from "../vendor/scm/components/NotifyDialog";
import { useConfirmProductionOrder, useProductionOrderDetail, useReopenProductionOrder, type MaterialStatus, type ProductionDetail } from "../vendor/scm/lib/production-order-queries";
import { materialCalculation } from "../pages/scm-v2/renovationProductionDays";
import { AddMaterialDialog, AssignDialog, ChangeNotice, ProductionTimeDialog, ProgressPhotos, ProgressSummary, RequestMoreDialog, ReturnStockDialog, useAddPhotos, useProductionPress } from "../pages/scm-v2/renovationProductionParts";
import { usePoCancelAction } from "../pages/scm-v2/use-production-cancel-action";
import { useHoldAction } from "../pages/scm-v2/use-hold-action";

const CAPS = "text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted";
const H2 = "m-0 text-[11px] font-semibold uppercase tracking-[.12em] text-ink-secondary";
const CARD = "rounded-lg border border-border bg-surface";
const LINK = "inline-flex min-h-[44px] items-center text-[12px] font-semibold text-primary";

function Info({ label, children, big }: { label: string; children: ReactNode; big?: boolean }) {
  return <div><div className={CAPS}>{label}</div><div className={cn("mt-1 font-semibold", big ? "text-[16px] font-bold" : "text-[14px]")}>{children}</div></div>;
}

function StockLine({ status, needed, uom }: { status: MaterialStatus | undefined; needed: number; uom: string }) {
  if (!status) return <span className="text-[12px] text-ink-muted">Checking…</span>;
  const ready = status.state === "received" || status.state === "stock";
  const word = ready ? "Ready" : status.state === "po" ? (status.eta ? `ETA ${fmtDate(status.eta)}` : "On order") : status.issued > 0 ? "Short" : "No PO yet";
  const tone = ready ? "bg-synced/10 text-synced" : status.state === "po" ? "bg-warning-bg text-warning-text" : "bg-err/10 text-err";
  const why = ready ? (status.issued > 0 ? `Issued ${fmtQty(status.issued)} ${uom}` : status.state === "received" ? `Received ${fmtQty(status.received)} ${uom}` : "In stock")
    : status.state === "po" ? `On order ${fmtQty(status.onOrder || needed)} ${uom}` : `Short ${fmtQty(status.shortQty ?? needed)} ${uom}`;
  return (
    <>
      <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{word}</span>
      <div className="mt-1 text-[12px] text-ink-secondary">{[status.poNumber, why].filter(Boolean).join(" · ")}</div>
    </>
  );
}

export function MobileProductionOrder({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = useProductionOrderDetail(id);
  const page = detail.data as unknown as ProductionDetail | undefined;
  const order = page?.purchaseOrder;
  const extra = order as unknown as { plan_start?: string | null; actual_start_at?: string | null; actual_start_by_name?: string | null; production_time_hours?: number | string | null; completion_step?: string | null; completion_error?: string | null } | undefined;
  const title = page?.project && (page.project.building || page.project.unit_no)
    ? [page.project.building, page.project.unit_no].filter(Boolean).join(" ")
    : (page?.linkedSo?.debtor_name as string | undefined) || order?.po_number || "Production order";
  const press = useProductionPress({ id, po_number: order?.po_number ?? "", title }, () => void detail.refetch());
  const photos = useAddPhotos(id);
  const { can, pageAccess } = useAuth();
  const mayAct = canOperateProductionOrders(can, pageAccess);
  const { cancelPo } = usePoCancelAction();
  const holdAction = useHoldAction("pro");
  const confirmOrder = useConfirmProductionOrder();
  const reopen = useReopenProductionOrder();
  const confirm = useConfirm();
  const notify = useNotify();
  const [dialog, setDialog] = useState<"time" | "assign" | "more" | "return" | "menu" | "add" | null>(null);
  const [showMore, setShowMore] = useState(false);
  const works = useMemo(() => (page?.items ?? []).map((l) => ({ qty: Number(l.qty), uom: l.uom })), [page?.items]);

  if (detail.isPending) return <div className="flex h-full flex-col bg-bg p-6 text-center text-[13px] text-ink-muted">Loading production order…</div>;
  if (detail.error || !order || !page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
        <p className="text-[13px] text-err">{detail.error instanceof Error ? detail.error.message : "The production order was not found."}</p>
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
    );
  }

  const status = order.status.toUpperCase();
  const started = Boolean(extra?.actual_start_at);
  const open = status === "SUBMITTED" && !order.on_hold;
  const canStart = open && !started && mayAct;
  const canComplete = open && (started || Boolean(extra?.completion_step)) && mayAct;
  const hours = extra?.production_time_hours == null ? null : Number(extra.production_time_hours);
  const { progress, workers } = page;
  const days = progress.planDays.length;
  const live = status === "SUBMITTED";
  const statusTone = progress.overdue ? "text-err" : started || status === "RECEIVED" ? "text-synced" : "text-warning-text";
  const stopped = status === "SUBMITTED" && Boolean(extra?.completion_step || extra?.completion_error);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <div className="shrink-0 border-b border-border bg-surface px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back" onClick={onBack} className="-ml-1 flex h-9 w-9 items-center justify-center text-ink-secondary"><ArrowLeft size={20} /></button>
          <h1 className="m-0 min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h1>
          <button type="button" onClick={() => setDialog("menu")} className="h-9 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-ink">More</button>
        </div>
        <div className="mt-1 flex justify-between gap-2.5 text-[12px]">
          <span className="font-mono font-semibold">{order.po_number}</span>
          <span className={cn("text-[11px] font-semibold uppercase tracking-[.06em]", statusTone)}>{progress.statusLabel}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          <ChangeNotice changes={page.changes} phone />
          {stopped && <div role="alert" className="rounded-lg border border-err/30 bg-surface px-3 py-2.5 text-[13px]"><strong>Complete stopped partway.</strong> {extra?.completion_error ?? "Press Retry Complete to carry on."}</div>}

          <div className={cn(CARD, "p-3")}>
            <div className="grid grid-cols-2 gap-2.5">
              <Info label="Plan start" big>{extra?.plan_start ? fmtDate(extra.plan_start) : "Not set"}</Info>
              <Info label="Plan finish" big>{order.expected_at ? fmtDate(order.expected_at) : "Not set"}</Info>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <Info label="Schedule" big>{days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "Not set"}</Info>
              <div>
                <div className={CAPS}>Production time</div>
                <div className="mt-1 flex items-baseline gap-2.5">
                  <span className="text-[16px] font-bold">{hours == null ? "Not set" : `${fmtQty(hours)} hours`}</span>
                  {mayAct && live && <button type="button" onClick={() => setDialog("time")} className="text-[12px] font-semibold text-primary">Set</button>}
                </div>
              </div>
            </div>
            {started && <div className="mt-2.5 border-t border-border-subtle pt-2.5 text-[13px] font-semibold">Actual start {fmtDate(extra?.actual_start_at ?? null)}</div>}
          </div>

          <section className={cn(CARD, "border-l-4 p-3", press.tally.ready || status === "RECEIVED" ? "border-l-synced" : "border-l-warning-text")}>
            <div className="text-[15px] font-bold">{status === "RECEIVED" ? "Completed" : press.tally.ready ? "Ready" : "Not ready"}</div>
            <div className="mb-2.5 mt-0.5 text-[13px] text-ink-secondary">{press.tally.total === 0 ? "No raw materials on this order" : `Raw materials ${press.tally.readyCount} of ${press.tally.total} ready`}</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Info label="Unit number">{page.project?.unit_no || "—"}</Info>
              <Info label="Building">{page.project?.building || "—"}</Info>
              <Info label="Project ID">{page.project?.code || "—"}</Info>
              <Info label="Sales order">{(page.linkedSo?.doc_no as string | undefined) || "—"}</Info>
            </div>
          </section>

          {started && <Workers workers={workers} onAssign={mayAct && live ? () => setDialog("assign") : undefined} />}

          <section className={CARD}>
            <h2 className={cn(H2, "border-b border-border-subtle px-3 py-2.5")}>Works · {page.items.length}</h2>
            {page.items.map((l) => (
              <div key={l.id} className="border-t border-border-subtle p-3 first:border-t-0">
                <div className="text-[14px] font-semibold">{l.item_code}</div>
                <div className="mt-0.5 text-[13px] text-ink-secondary">{[(l as unknown as { room?: string | null }).room, `${fmtQty(Number(l.qty))} ${l.uom ?? ""}`].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
          </section>

          <section className={CARD}>
            <div className="flex items-center justify-between gap-2.5 border-b border-border-subtle px-3 py-1">
              <h2 className={H2}>Raw materials · {press.materials.length}</h2>
              {!started && live && mayAct && <button type="button" onClick={() => setDialog("add")} className={LINK}>Add raw material</button>}
            </div>
            {press.materials.length === 0 && <p className="p-3 text-[13px] text-ink-muted">No raw materials on this order yet.</p>}
            {press.materials.map((m) => (
              <div key={m.id} className="border-t border-border-subtle p-3 first:border-t-0">
                <div className="flex justify-between gap-2.5">
                  <b className="text-[14px] font-semibold">{m.description || m.item_code}</b>
                  <b className="whitespace-nowrap text-[13px] font-semibold">{fmtQty(Number(m.qty_needed))} {m.uom ?? ""}</b>
                </div>
                <div className="mb-1.5 mt-0.5 text-[12px] text-ink-muted">{materialCalculation(m, works)} · Warehouse <b className="font-semibold text-ink">{press.statuses?.[m.id]?.warehouse ?? "None"}</b></div>
                <StockLine status={press.statuses?.[m.id]} needed={Number(m.qty_needed)} uom={m.uom ?? ""} />
              </div>
            ))}
            {started && mayAct && (live || status === "RECEIVED") && (
              <div className="grid grid-cols-2 gap-2 border-t border-border-subtle p-3">
                <button type="button" onClick={() => setDialog("return")} className="h-11 rounded-md border border-border bg-surface text-[13px] font-semibold">Return stock</button>
                {live ? <button type="button" onClick={() => setDialog("more")} className="h-11 rounded-md border border-border bg-surface text-[13px] font-semibold">Request more</button> : <span />}
              </div>
            )}
          </section>

          {!started && <Workers workers={workers} onAssign={mayAct && live ? () => setDialog("assign") : undefined} />}

          {(started || status === "RECEIVED") && (
            <section className={CARD}>
              <h2 className={cn(H2, "border-b border-border-subtle px-3 py-2.5")}>Progress{progress.label ? ` · ${progress.label}` : ""}</h2>
              {started && live && <ProgressSummary progress={progress} hours={hours} phone />}
              <ProgressPhotos orderId={id} progress={progress} holidays={page.holidays} phone canAdd={mayAct && live} finishedOn={order.received_at?.slice(0, 10) ?? null} />
            </section>
          )}

          <button type="button" onClick={() => setShowMore((v) => !v)} className={cn(CARD, "flex min-h-[44px] items-center justify-between px-3 text-[13px] font-semibold")}>
            <span>Value, people and activity</span><span className="text-primary">{showMore ? "Hide" : "Show"}</span>
          </button>
          {showMore && (
            <div className={cn(CARD, "space-y-2 p-3 text-[13px]")}>
              <div className="flex justify-between"><span className="text-ink-secondary">Production order value</span><b>{fmtMoneySen(order.total_sen ?? 0, order.currency)}</b></div>
              <div className="flex justify-between"><span className="text-ink-secondary">Done by</span><b>{order.supplier?.name ?? "—"}</b></div>
              <div className="flex justify-between"><span className="text-ink-secondary">Document date</span><b>{fmtDate(order.po_date)}</b></div>
              {order.submitted_at && <div className="flex justify-between"><span className="text-ink-secondary">Issued</span><b>{fmtDate(order.submitted_at)}</b></div>}
              {started && <div className="flex justify-between"><span className="text-ink-secondary">Started</span><b>{[fmtDate(extra?.actual_start_at ?? null), extra?.actual_start_by_name].filter(Boolean).join(" · ")}</b></div>}
              {order.received_at && <div className="flex justify-between"><span className="text-ink-secondary">Completed</span><b>{fmtDate(order.received_at)}</b></div>}
            </div>
          )}
        </div>
      </div>

      {(canStart || canComplete || (status === "DRAFT" && mayAct)) && (
        <div className="shrink-0 border-t border-border bg-surface px-4 pb-3.5 pt-2.5">
          {status === "DRAFT" && <button type="button" onClick={() => confirmOrder.mutate(id)} className="h-[52px] w-full rounded-md bg-sidebar text-[15px] font-bold text-white">Confirm</button>}
          {canStart && <button type="button" disabled={press.starting} onClick={() => void press.pressStart()} className="h-[52px] w-full rounded-md bg-sidebar text-[15px] font-bold text-white disabled:opacity-50">{press.starting ? "Starting…" : "Start"}</button>}
          {canComplete && (
            <div className="flex flex-col gap-2">
              <PhotoUploads queue={photos} hideDone />
              <PhotoAddButtons queue={photos} video />
              <button type="button" disabled={press.completing !== null} onClick={() => void press.complete()} className="h-[52px] w-full rounded-md border border-border bg-surface text-[15px] font-bold disabled:opacity-50">{press.completing ?? (stopped ? "Retry Complete" : "Complete")}</button>
            </div>
          )}
        </div>
      )}

      {press.dialog}
      <ProductionTimeDialog orderId={id} hours={hours} open={dialog === "time"} onClose={() => setDialog(null)} />
      <AssignDialog orderId={id} workers={workers} open={dialog === "assign"} onClose={() => setDialog(null)} />
      <AddMaterialDialog orderId={id} taken={new Set(press.materials.map((m) => m.item_code))} open={dialog === "add"} onClose={() => setDialog(null)} />
      <RequestMoreDialog orderId={id} open={dialog === "more"} onClose={() => setDialog(null)} />
      <ReturnStockDialog orderId={id} materials={press.materials} open={dialog === "return"} onClose={() => setDialog(null)} />
      <ModalOverlay open={dialog === "menu"} onClose={() => setDialog(null)} title="More">
        <div className="flex flex-col gap-2">
          {mayAct && (status === "SUBMITTED" || status === "DRAFT") && <Button variant="secondary" onClick={() => { setDialog(null); void holdAction(id, order.po_number, !order.on_hold); }}>{order.on_hold ? "Take off hold" : "Put on hold"}</Button>}
          {mayAct && (status === "CANCELLED" || status === "RECEIVED") && (
            <Button variant="secondary" onClick={() => {
              setDialog(null);
              void (async () => {
                if (await confirm({ title: `Reopen ${order.po_number}?`, confirmLabel: "Reopen" })) reopen.mutate(id, { onError: (e) => notify({ title: "Not reopened", body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" }) });
              })();
            }}>Reopen</Button>
          )}
          {mayAct && status !== "CANCELLED" && status !== "RECEIVED" && <Button variant="danger" onClick={() => { setDialog(null); void cancelPo(id, order.po_number); }}>Cancel Production Order</Button>}
          {!mayAct && <p className="text-[13px] text-ink-muted">You can look at this order but not change it.</p>}
        </div>
      </ModalOverlay>
    </div>
  );
}

function Workers({ workers, onAssign }: { workers: ProductionDetail["workers"]; onAssign?: () => void }) {
  return (
    <section className={cn(CARD, "px-3 pb-2 pt-1")}>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className={H2}>Workers</h2>
        {onAssign ? <button type="button" onClick={onAssign} className={LINK}>Assign</button> : <span className="min-h-[44px]" />}
      </div>
      {workers.length === 0 && <div className="text-[13px] text-ink-muted">Nobody yet</div>}
      {workers.map((w) => <div key={w.id} className="py-1.5 text-[13px]"><b className="font-semibold">{w.name}</b> <span className="text-ink-muted">{w.how === "STARTED" ? "Pressed Start" : "Assigned"}</span></div>)}
    </section>
  );
}
