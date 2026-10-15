/* One renovation project, simplified (owner decisions 11 and 14 Oct 2026): the six
   main steps with the hold flag, what the sales order says (contract, received,
   VO), design (the main task: onsite, 3D, 2D), procurement details per product
   category (the documents hub since batch 4: SO, DO with proof of delivery, POs
   and GRs), the unit key and the project team. The older stage
   machinery (checklists, gate) still runs underneath on the server; its screen
   section was replaced by Procurement details, and the billing prompt stays on top
   when there is something to bill. Snag list and handover form are no longer on
   this page (their APIs and data are unchanged). Every write goes through
   /api/renovation and the page reloads from the server afterwards. */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { renovationApi, type ProjectDetail } from "./renovationApi";
import { errorText, money, shortDate, supplyLabel, supplyTone } from "./renovationModel";
import { Dialog, Field, Pill, inputClass } from "./renovationUi";
import { simpleApi, type ProjectDetailV2 } from "./simpleApi";
import { FlowPanel } from "./FlowPanel";
import { ContractCard, KeyCard, PeopleCard } from "./ProjectRecords";
import { DesignTaskCard } from "./DesignTask";
import { ProcurementPanel } from "./ProcurementPanel";
import { CustomerInfoCard } from "./CustomerInfoCard";

export function RenovationDetail({ id, canWrite, embedded = false }: { id: number; canWrite: boolean; embedded?: boolean }) {
  const q = useQuery(["renovation", "detail", id], () => simpleApi.detail(id), [id]);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const d = q.data;
  /* Procurement details is the documents hub (mig 0116); the older Documents card shows only before it is applied. */
  const docsReady = useQuery(["renovation", "documents", id], () => simpleApi.documents(id), [id]).data?.ready === true;

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
        /* One line under the title (owner, 14 Oct 2026): customer · phone · building unit · layout. */
        description={[p.customer_name, p.customer_phone, [p.building, p.unit_no].filter(Boolean).join(" "), p.layout_label, d.type?.name].filter(Boolean).join(" · ")}
        actions={<Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => q.reload()}>Refresh</Button>}
      />

      {notice && (
        <div role={notice.tone === "err" ? "alert" : "status"} className={cn("mb-3 rounded-md border px-3 py-2 text-sm", notice.tone === "err" ? "border-err/30 bg-err-bg text-err" : "border-synced/30 bg-synced-bg text-synced")}>
          {notice.text}
        </div>
      )}

      <FlowPanel projectId={id} flow={d.flow} hold={d.hold} canWrite={canWrite} onChanged={done} facts={<ProjectFacts d={d} />} />
      {!d.financeHidden && d.so && <BillingPromptBanner d={d} canWrite={canWrite} onDone={done} onError={failed} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {/* Left = work (owner, 14 Oct 2026): Design and Procurement details (the documents hub, with each DO's proof
              of delivery). Right = reference. Site tasks and the room photo gallery left this page (their data and
              APIs are unchanged; the calendar still reads the tasks). */}
          <DesignTaskCard projectId={id} canWrite={canWrite} onDone={(t) => setNotice({ tone: "ok", text: t })} onError={failed} />
          <ProcurementPanel projectId={id} canWrite={canWrite} onError={failed} showMoney={!d.financeHidden} />
          {d.serviceCases.length > 0 && <WarrantyPanel d={d} />}
        </div>
        <aside className="space-y-4 min-w-0">
          <CustomerInfoCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <PeopleCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <KeyCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          <ContractCard d={d} canWrite={canWrite} onDone={done} onError={failed} />
          {!docsReady && <LinkedDocuments d={d} />}
          {d.redFlags.length > 0 && (
            <section className="rounded-lg border border-err/30 bg-err-bg p-3">
              <h3 className="text-sm font-semibold text-err flex items-center gap-1"><AlertTriangle size={14} />Red flags</h3>
              <ul className="mt-1 text-sm text-err list-disc pl-5">{d.redFlags.map((f) => <li key={f.code}>{f.text}</li>)}</ul>
            </section>
          )}
        </aside>
      </div>

    </div>
  );
}

/** The facts worth a glance, inside the step card: only those that say something (no row of dashes). */
function ProjectFacts({ d }: { d: ProjectDetailV2 }) {
  const facts: Array<[string, ReactNode]> = [];
  const handover = d.handover?.signed_at ?? d.project.handed_over_at;
  if (d.so && !d.financeHidden) {
    facts.push(["Contract", money(d.money.contractSen)]);
    if (d.money.receivedSen != null) facts.push(["Received", `${money(d.money.receivedSen)}${d.money.receivedPct != null ? ` (${d.money.receivedPct}%)` : ""}`]);
  }
  if (d.so && d.conditions.furniture?.condition) facts.push(["Furniture", <Pill tone={supplyTone(d.conditions.furniture.condition)}>{supplyLabel(d.conditions.furniture.condition)}</Pill>]);
  if (d.so && d.conditions.renoItem?.condition) facts.push(["Reno items", <Pill tone={supplyTone(d.conditions.renoItem.condition)}>{supplyLabel(d.conditions.renoItem.condition)}</Pill>]);
  if (d.keyHolder?.name) facts.push(["Key with", d.keyHolder.name]);
  if (handover) facts.push(["Handed over", shortDate(handover)]);
  else if (d.project.planned_handover_date) facts.push(["Handover planned", shortDate(d.project.planned_handover_date)]);
  if (facts.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {facts.map(([label, value]) => (
        <div key={label} className="flex items-center gap-1.5"><dt className="text-ink-secondary">{label}</dt><dd className="font-medium text-ink">{value}</dd></div>
      ))}
    </dl>
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
      <h3 className="text-base font-semibold text-ink">Service cases ({d.serviceCases.length})</h3>
      {d.serviceCases.length === 0
        ? <p className="mt-2 text-sm text-ink-secondary">No complaints since handover.</p>
        : <ul className="mt-2 divide-y divide-border">{d.serviceCases.map((c) => <li key={c.id} className="py-2 text-sm"><Link className="text-primary" to={`/assr/${c.id}`}>{c.assr_no}</Link> · {c.status ?? "-"} · {c.complaint_issue ?? ""}</li>)}</ul>}
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
