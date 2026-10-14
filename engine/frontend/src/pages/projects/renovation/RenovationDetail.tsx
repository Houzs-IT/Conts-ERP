/* One renovation project, simplified (owner decisions 11 and 14 Oct 2026): the six
   main steps with the hold flag, what the sales order says (contract, received,
   VO), design (the main task: onsite, 3D, 2D), site tasks, procurement dates per
   product category, arrivals, the unit key and the project team. The older stage
   machinery (checklists, gate) still runs underneath on the server; its screen
   section was replaced by Procurement details, and the billing prompt stays on top
   when there is something to bill. Snag list and handover form are no longer on
   this page (their APIs and data are unchanged). Every write goes through
   /api/renovation and the page reloads from the server afterwards. */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Printer, RefreshCw } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { api } from "../../../api/client";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { renovationApi, type ProjectDetail } from "./renovationApi";
import { errorText, money, shortDate, supplyLabel, supplyTone } from "./renovationModel";
import { AuthImage, Dialog, Field, Pill, SkipReasonDialog, inputClass } from "./renovationUi";
import { HOLD_FLAG_LABEL } from "../../../vendor/shared/renovation-stages";
import { simpleApi, type ProjectDetailV2 } from "./simpleApi";
import { FlowPanel } from "./FlowPanel";
import { ContractCard, KeyCard, PeopleCard } from "./ProjectRecords";
import { DesignTaskCard } from "./DesignTask";
import { ProcurementPanel } from "./ProcurementPanel";
import { SiteTasksPanel } from "./SiteTasksPanel";
import { CustomerInfoCard } from "./CustomerInfoCard";

type Skipping = { id: number; label: string };

export function RenovationDetail({ id, canWrite, embedded = false }: { id: number; canWrite: boolean; embedded?: boolean }) {
  const q = useQuery(["renovation", "detail", id], () => simpleApi.detail(id), [id]);
  const [skipping, setSkipping] = useState<Skipping | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const d = q.data;

  async function act(fn: () => Promise<unknown>, okText?: string) {
    setNotice(null);
    try {
      await fn();
      if (okText) setNotice({ tone: "ok", text: okText });
      q.reload();
    } catch (e) {
      setNotice({ tone: "err", text: errorText(e) });
    }
  }
  const done = (text: string) => { setNotice({ tone: "ok", text }); q.reload(); };
  const failed = (text: string) => setNotice({ tone: "err", text });

  if (q.loading && !d) return <p className="py-10 text-center text-sm text-ink-secondary">Loading project...</p>;
  if (q.error || !d) return <p role="alert" className="py-6 text-sm text-err">The project could not be loaded: {q.error ?? "not found"}</p>;
  const p = d.project;

  return (
    <div className="pb-10">
      <PageHeader
        back={embedded ? undefined : "/projects"}
        eyebrow={`Renovation · ${p.code ?? ""}`}
        title={p.name}
        description={[[p.building, p.unit_no].filter(Boolean).join(" "), p.customer_name, d.type?.name].filter(Boolean).join(" · ")}
        actions={<Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => q.reload()}>Refresh</Button>}
      />

      {notice && (
        <div role={notice.tone === "err" ? "alert" : "status"} className={cn("mb-3 rounded-md border px-3 py-2 text-sm", notice.tone === "err" ? "border-err/30 bg-err-bg text-err" : "border-synced/30 bg-synced-bg text-synced")}>
          {notice.text}
        </div>
      )}

      <FlowPanel projectId={id} flow={d.flow} hold={d.hold} canWrite={canWrite} onChanged={done} />
      <SummaryStrip d={d} />
      {!d.financeHidden && d.so && <BillingPromptBanner d={d} canWrite={canWrite} onDone={done} onError={failed} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {/* Left = work (owner, 14 Oct 2026): Design, Procurement, Site tasks. Right = reference. */}
          <DesignTaskCard projectId={id} canWrite={canWrite} onDone={(t) => setNotice({ tone: "ok", text: t })} onError={failed} />
          <ProcurementPanel projectId={id} canWrite={canWrite} onError={failed} />
          <SiteTasksPanel
            projectId={id}
            tasks={d.tasks}
            canWrite={canWrite}
            linesAvailable={!d.linesUnavailable}
            onAct={act}
            onSkip={(t) => setSkipping({ id: t.id, label: t.label })}
          />
          {d.serviceCases.length > 0 && <WarrantyPanel d={d} />}
          <EvidenceGallery projectId={id} />
        </div>
        <aside className="space-y-4 min-w-0">
          <CustomerInfoCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <PeopleCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <KeyCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <ContractCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <LinkedDocuments d={d} />
          {d.redFlags.length > 0 && (
            <section className="rounded-lg border border-err/30 bg-err-bg p-3">
              <h3 className="text-sm font-semibold text-err flex items-center gap-1"><AlertTriangle size={14} />Red flags</h3>
              <ul className="mt-1 text-sm text-err list-disc pl-5">{d.redFlags.map((f) => <li key={f.code}>{f.text}</li>)}</ul>
            </section>
          )}
        </aside>
      </div>

      {skipping && (
        <SkipReasonDialog
          what={skipping.label}
          onCancel={() => setSkipping(null)}
          onConfirm={async (reason) => {
            try {
              await renovationApi.skipTask(skipping.id, reason);
            } catch (e) {
              throw new Error(errorText(e));
            }
            setSkipping(null);
            setNotice({ tone: "ok", text: `${skipping.label} skipped. The reason is recorded.` });
            q.reload();
          }}
        />
      )}
    </div>
  );
}

function SummaryStrip({ d }: { d: ProjectDetailV2 }) {
  const cell = (label: string, value: ReactNode) => (
    <div className="min-w-0"><div className="text-xs text-ink-secondary">{label}</div><div className="text-sm text-ink truncate">{value}</div></div>
  );
  const handover = d.handover?.signed_at ?? d.project.handed_over_at;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 rounded-lg border border-border bg-surface p-3 mb-3">
      {cell("Status", <span className={d.hold ? "font-semibold text-err" : ""}>{[d.hold ? HOLD_FLAG_LABEL[d.hold.flag] : null, d.flow.currentLabel].filter(Boolean).join(" · ")}</span>)}
      {cell("Contract total", d.financeHidden ? "Hidden" : d.so ? money(d.money.contractSen) : "No SO yet")}
      {cell("Received", d.financeHidden ? "Hidden" : !d.so ? "-" : d.money.receivedSen == null ? "Not available" : `${money(d.money.receivedSen)}${d.money.receivedPct != null ? ` (${d.money.receivedPct}%)` : ""}`)}
      {cell("Furniture", d.so ? <Pill tone={supplyTone(d.conditions.furniture?.condition)}>{supplyLabel(d.conditions.furniture?.condition)}</Pill> : "-")}
      {cell("Reno items", d.so ? <Pill tone={supplyTone(d.conditions.renoItem?.condition)}>{supplyLabel(d.conditions.renoItem?.condition)}</Pill> : "-")}
      {cell("Key holder", d.keyHolder?.name ?? "-")}
      {cell(handover ? "Handed over" : "Planned handover", shortDate(handover ?? d.project.planned_handover_date))}
    </div>
  );
}

function BillingPromptBanner({ d, canWrite, onDone, onError }: { d: ProjectDetail; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [confirming, setConfirming] = useState<null | ProjectDetail["prompts"][number]>(null);
  const [date, setDate] = useState(() => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  if (!d.billing.available) {
    return <div className="mb-3 rounded-md border border-border bg-surface-dim px-3 py-2 text-sm text-ink-secondary">Customer billing is not available yet, so no instalment can be billed from here.</div>;
  }
  if (d.prompts.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {d.prompts.map((pr) => (
        <div key={pr.instalmentId} className="flex flex-wrap items-center justify-between gap-2 py-1">
          <div className="text-sm">
            <span className="font-semibold text-ink">Instalment {pr.seq}: {pr.label}</span>
            {pr.description && <span className="text-ink-secondary"> · {pr.description}</span>}
            {pr.dueSen != null && <span className="text-ink-secondary"> · {money(pr.dueSen)}</span>}
            {!pr.actionable && <span className="text-ink-secondary"> · waiting for the earlier instalment</span>}
          </div>
          {pr.actionable && canWrite && <Button onClick={() => setConfirming(pr)}>Bill instalment {pr.seq}</Button>}
        </div>
      ))}
      {confirming && d.so && (
        <Dialog
          title={`Bill instalment ${confirming.seq}`}
          onClose={() => setConfirming(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await renovationApi.bill(d.so!.doc_no, confirming.instalmentId, confirming.dueSen, date);
                setConfirming(null);
                onDone(`Instalment ${confirming.seq} billed.`);
              } catch (e) {
                onError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}>{busy ? "Billing..." : "Issue progress invoice"}</Button>
          </>}
        >
          <p className="text-sm text-ink-secondary mb-3">A progress invoice for {confirming.label}{confirming.dueSen != null ? ` (${money(confirming.dueSen)})` : ""} will be issued to the customer.</p>
          <Field label="Invoice date"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </Dialog>
      )}
    </div>
  );
}

function WarrantyPanel({ d }: { d: ProjectDetail }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-semibold text-ink">Warranty: service cases</h3>
      {d.serviceCases.length === 0
        ? <p className="mt-2 text-sm text-ink-secondary">No complaints since handover.</p>
        : <ul className="mt-2 divide-y divide-border">{d.serviceCases.map((c) => <li key={c.id} className="py-2 text-sm"><Link className="text-primary" to={`/assr?case=${c.id}`}>{c.assr_no}</Link> · {c.status ?? "-"} · {c.complaint_issue ?? ""}</li>)}</ul>}
    </section>
  );
}

function EvidenceGallery({ projectId }: { projectId: number }) {
  const q = useQuery(["renovation", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const [big, setBig] = useState<string | null>(null);
  const rooms = q.data?.rooms ?? [];
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Proof of delivery by room</h3>
        <Button variant="secondary" icon={<Printer size={14} />} onClick={() => void api.openHtml(`/api/renovation/${projectId}/pod/print`)}>Print note</Button>
      </div>
      {q.loading && <p className="mt-2 text-sm text-ink-secondary">Loading photos...</p>}
      {!q.loading && rooms.length === 0 && <p className="mt-2 text-sm text-ink-secondary">No site receipt photos yet.</p>}
      {rooms.map((g) => (
        <div key={g.room} className="mt-3">
          <div className="text-sm font-medium text-ink">{g.room} <span className="text-ink-secondary font-normal">({g.photos.length})</span></div>
          <div className="mt-1 grid grid-cols-3 sm:grid-cols-5 gap-2">
            {g.photos.map((ph) => (
              <AuthImage key={ph.id} path={renovationApi.fileUrl(projectId, ph.r2_key)} alt={`${g.room} ${ph.kind}`} className="h-20 w-full rounded" onClick={() => setBig(ph.r2_key)} />
            ))}
          </div>
        </div>
      ))}
      {big && (
        <Dialog title="Photo" onClose={() => setBig(null)}>
          <AuthImage path={renovationApi.fileUrl(projectId, big)} alt="Proof of delivery" className="w-full rounded" />
        </Dialog>
      )}
    </section>
  );
}

function LinkedDocuments({ d }: { d: ProjectDetail }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold text-ink">Documents</h3>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-secondary">Sales order</dt>
          <dd>{d.so ? <Link className="text-primary" to={`/scm/sales-orders/${encodeURIComponent(d.so.doc_no)}`}>{d.so.doc_no}</Link> : "Not converted yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-secondary">Purchase orders</dt>
          <dd>{d.purchaseOrders.length === 0 ? "None yet" : (
            <ul>{d.purchaseOrders.map((po) => <li key={po.id}><Link className="text-primary" to={`/scm/purchase-orders/${po.id}`}>{po.po_number}</Link> · {po.supplier_name ?? "-"}{po.received ? " · received" : ""}</li>)}</ul>
          )}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-secondary">Receipts</dt>
          <dd>{d.receipts.length === 0 ? "None yet" : (
            <ul>{d.receipts.map((g) => <li key={g.id}><Link className="text-primary" to={`/scm/grns/${g.id}`}>{g.grn_number}</Link>{g.received_at_site ? " · on site" : ""}{g.site_received_at ? ` · ${shortDate(g.site_received_at)}` : ""}</li>)}</ul>
          )}</dd>
        </div>
      </dl>
    </section>
  );
}
