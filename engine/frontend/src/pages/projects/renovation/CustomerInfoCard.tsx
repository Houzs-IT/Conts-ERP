/* Project detail, right column: the project's customer and property (owner,
   14 Oct 2026; migrations 0112, 0115). The same CustomerBlock the sales order
   uses: read-only here, and the Edit dialog asks for exactly what the SO asks
   for, with the same required fields. The project is the master record: saving
   refreshes its sales orders that are still open (rule in
   vendor/shared/renovation-property.ts). Before 0112 the card shows the
   customer fields the project already had and offers no Edit. */

import { useState } from "react";
import { Pencil, UserRound } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { Card } from "./ProjectRecords";
import { CustomerBlock } from "./CustomerBlock";
import { projectInfoApi } from "./customerPropertyApi";
import { EMPTY_CUSTOMER_PROPERTY, fromProject, missingFields, toProjectBody, type CustomerPropertyValue } from "./customerPropertyModel";
import { errorText } from "./renovationModel";
import { Dialog } from "./renovationUi";
import type { ProjectDetailV2 } from "./simpleApi";

export function CustomerInfoCard({ d, canWrite, onDone, onError: _onError }: {
  d: ProjectDetailV2; canWrite: boolean; onDone: (text: string) => void; onError: (text: string) => void;
}) {
  const id = d.project.id;
  const info = useQuery(["renovation", "customer-info", id], () => projectInfoApi.get(id).catch(() => null), [id]);
  const lists = useQuery(["renovation", "property-lists"], () => projectInfoApi.lists());
  const [editing, setEditing] = useState<CustomerPropertyValue | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = lists.data?.ready === true && !!info.data;
  const p = info.data?.project ?? null;
  const sos = info.data?.salesOrders ?? [];
  /* Before 0112 (no customer-info read): what the project row itself has. */
  const shown: CustomerPropertyValue = p ? fromProject(p) : {
    ...EMPTY_CUSTOMER_PROPERTY, customerName: d.project.customer_name ?? "", customerPhone: d.project.customer_phone ?? "",
    customerEmail: d.project.customer_email ?? "", address1: d.project.site_address ?? "", building: d.project.building ?? "", unitNo: d.project.unit_no ?? "",
  };

  /* Nothing but the name the project was opened with counts as empty. */
  const empty = [shown.customerPhone, shown.customerEmail, shown.address1, shown.building, shown.unitNo, shown.propertyType, shown.layoutLabel, shown.builtUpSqft]
    .every((x) => !x.trim());

  async function save() {
    if (!editing) return;
    setTried(true);
    const miss = missingFields(editing);
    if (miss.size > 0) { setError(`Fill in: ${[...miss].join(", ")}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await projectInfoApi.save(id, toProjectBody(editing));
      setEditing(null);
      setTried(false);
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
      actions={canWrite && ready && p && !empty
        ? <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => { setError(null); setTried(false); setEditing(fromProject(p)); }}>Edit</Button>
        : undefined}
    >
      {empty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink-secondary">No customer details yet.</span>
          {canWrite && ready && p && <Button variant="secondary" onClick={() => { setError(null); setTried(false); setEditing(fromProject(p)); }}>Add details</Button>}
        </div>
      ) : (
        <CustomerBlock mode="project" readOnly value={shown} onChange={() => undefined} lists={lists.data ?? undefined} project={p} hideProperty={!ready} />
      )}
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
          <CustomerBlock mode="project" value={editing} onChange={setEditing} lists={lists.data ?? undefined} project={p} disabled={busy}
            missing={tried ? missingFields(editing) : undefined} />
          <p className="mt-3 text-xs text-ink-secondary">Open sales orders of this project take these values when you save.</p>
          {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
        </Dialog>
      )}
    </Card>
  );
}
