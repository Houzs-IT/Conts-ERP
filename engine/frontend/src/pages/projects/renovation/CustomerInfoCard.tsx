/* Project detail, right column: the project's customer and property (owner,
   14 Oct 2026; migration 0112). Read-only with an Edit button that opens the
   shared CustomerPropertyFields block. The project is the master record: saving
   here refreshes its sales orders that are still open (the rule is in
   vendor/shared/renovation-property.ts). Before 0112 is in the database the card
   shows the customer fields the project already had and offers no Edit. */

import { useState, type ReactNode } from "react";
import { Pencil, UserRound } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { Card } from "./ProjectRecords";
import { CustomerPropertyFields } from "./CustomerPropertyFields";
import { projectInfoApi } from "./customerPropertyApi";
import { fromProject, toProjectBody, type CustomerPropertyValue } from "./customerPropertyModel";
import { errorText } from "./renovationModel";
import { Dialog } from "./renovationUi";
import type { ProjectDetailV2 } from "./simpleApi";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <dt className="w-24 shrink-0 text-xs text-ink-secondary pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children || <span className="text-ink-secondary">Not set</span>}</dd>
    </div>
  );
}

export function CustomerInfoCard({ d, canWrite, onDone, onError }: {
  d: ProjectDetailV2; canWrite: boolean; onDone: (text: string) => void; onError: (text: string) => void;
}) {
  const id = d.project.id;
  const info = useQuery(["renovation", "customer-info", id], () => projectInfoApi.get(id).catch(() => null), [id]);
  const lists = useQuery(["renovation", "property-lists"], () => projectInfoApi.lists());
  const [editing, setEditing] = useState<CustomerPropertyValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = lists.data?.ready === true && !!info.data;
  const p = info.data?.project;

  const sos = info.data?.salesOrders ?? [];
  const layout = p ? (p.layoutLabel || (p.bedrooms != null ? `${p.bedrooms} bed ${p.bathrooms ?? "?"} bath` : "")) : "";

  async function save() {
    if (!editing) return;
    if (!editing.customerName.trim()) { setError("Customer name is required."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await projectInfoApi.save(id, toProjectBody(editing));
      setEditing(null);
      info.reload();
      onDone(r.salesOrdersUpdated.length
        ? `Customer info saved. Updated the open sales order${r.salesOrdersUpdated.length === 1 ? "" : "s"} ${r.salesOrdersUpdated.join(", ")}.`
        : "Customer info saved.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Customer info"
      icon={<UserRound size={14} />}
      actions={canWrite && ready && p
        ? <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => { setError(null); setEditing(fromProject(p)); }}>Edit</Button>
        : undefined}
    >
      <dl>
        <Row label="Customer">{p?.customerName ?? d.project.customer_name}</Row>
        <Row label="Phone">{p?.customerPhone ?? d.project.customer_phone}</Row>
        <Row label="Email">{p?.customerEmail ?? d.project.customer_email}</Row>
        <Row label="Address"><span className="whitespace-pre-line">{p?.siteAddress ?? d.project.site_address}</span></Row>
        <Row label="Building">{[p?.building ?? d.project.building, p?.unitNo ?? d.project.unit_no].filter(Boolean).join(" · ")}</Row>
        {ready && (
          <>
            <Row label="Property">{p?.propertyType}</Row>
            <Row label="Layout">{layout}</Row>
            <Row label="Built-up">{p?.builtUpSqft != null ? `${p.builtUpSqft.toLocaleString("en-MY")} sq ft` : ""}</Row>
          </>
        )}
      </dl>
      {ready && sos.length > 0 && (
        <p className="mt-2 border-t border-border pt-2 text-xs text-ink-secondary">
          Shared with {sos.map((s) => `${s.docNo}${s.followsProject ? "" : " (kept as printed)"}`).join(", ")}.
        </p>
      )}
      {editing && (
        <Dialog
          title="Customer info"
          wide
          onClose={() => setEditing(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
          </>}
        >
          <CustomerPropertyFields mode="project" value={editing} onChange={setEditing} lists={lists.data ?? undefined} disabled={busy} />
          <p className="mt-3 text-xs text-ink-secondary">Open sales orders of this project take these values when you save.</p>
          {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
        </Dialog>
      )}
    </Card>
  );
}
