/* Raw materials on a production order (owner, 4 Nov 2026): what the job needs, each with when to order it and when it
   must arrive. A material with a delivery date shows in MRP's Raw material tab; its status here reads the same plan. */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { fmtDate, fmtQty } from "@2990s/shared";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Section } from "../../components/DetailLayout";
import { DateField } from "../../vendor/scm/components/DateField";
import { SearchableSelect } from "../../vendor/scm/components/SearchableSelect";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import {
  useAddProductionMaterial, useDeleteProductionMaterial, useMaterialStatus, useProductionMaterials, useRawSkus, useUpdateProductionMaterial,
  type MaterialRow, type MaterialStatus,
} from "../../vendor/scm/lib/production-order-queries";

function StatusChip({ status, needed, uom }: { status: MaterialStatus | undefined; needed: number; uom: string }) {
  if (!status) return <span className="text-[12px] text-ink-muted">Checking…</span>;
  if (status.state === "received") return <Badge tone="success" size="xs">Received {fmtQty(status.received)} {uom}</Badge>;
  if (status.state === "stock") return <Badge tone="success" size="xs">In stock</Badge>;
  if (status.state === "po") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="warning" size="xs">On order</Badge>
        {status.poId
          ? <Link to={`/scm/purchase-orders/${status.poId}`} className="font-mono text-[11.5px] font-semibold text-primary hover:underline">{status.poNumber}</Link>
          : <span className="font-mono text-[11.5px] text-ink-secondary">{status.poNumber}</span>}
        {status.eta && <span className="text-[11.5px] text-ink-muted">ETA {fmtDate(status.eta)}</span>}
      </span>
    );
  }
  return <Badge tone="error" size="xs">Short {fmtQty(status.shortQty ?? needed)} {uom}</Badge>;
}

export function ProductionMaterialsSection({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const materials = useProductionMaterials(orderId);
  const statuses = useMaterialStatus(orderId);
  const skus = useRawSkus(canEdit);
  const add = useAddProductionMaterial(orderId);
  const update = useUpdateProductionMaterial(orderId);
  const remove = useDeleteProductionMaterial(orderId);
  const confirm = useConfirm();
  const notify = useNotify();
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  const [processingDate, setProcessingDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");

  const rows = materials.data ?? [];
  const noSkus = canEdit && skus.isSuccess && skus.data.length === 0;
  const refused = (title: string) => (e: unknown) => notify({ title, body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" });

  const addOne = () => {
    if (!code) return;
    add.mutate({ itemCode: code, qtyNeeded: Number(qty), processingDate: processingDate || null, deliveryDate: deliveryDate || null }, {
      onSuccess: () => { setCode(""); setQty("1"); setProcessingDate(""); setDeliveryDate(""); },
      onError: refused("Material not added"),
    });
  };
  const save = (m: MaterialRow, patch: { qtyNeeded?: number; processingDate?: string | null; deliveryDate?: string | null }) =>
    update.mutate({ id: m.id, ...patch }, { onError: refused("Not saved") });
  const drop = async (m: MaterialRow) => {
    if (await confirm({ title: `Remove ${m.item_code}?`, confirmLabel: "Remove" })) remove.mutate(m.id, { onError: refused("Not removed") });
  };

  return (
    <Section title={`Raw materials · ${rows.length}`}>
      {materials.error ? (
        <p role="alert" className="text-[13px] text-err">The raw materials could not be loaded.</p>
      ) : rows.length === 0 && !materials.isLoading ? (
        <p className="text-[13px] text-ink-muted">No raw materials on this order yet.</p>
      ) : rows.length > 0 && (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[9.5px] uppercase tracking-brand text-ink-muted">
                <th className="px-1 py-2 font-semibold">Material</th>
                <th className="px-1 py-2 text-right font-semibold">Qty</th>
                <th className="px-1 py-2 font-semibold">Processing date</th>
                <th className="px-1 py-2 font-semibold">Delivery date</th>
                <th className="px-1 py-2 font-semibold">Stock status</th>
                <th className="w-8 px-1 py-2" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-1 py-2">
                    <div className="font-semibold text-ink">{m.description || m.item_code}</div>
                    <div className="font-mono text-[11px] text-ink-muted">{m.item_code}</div>
                  </td>
                  <td className="px-1 py-2 text-right">
                    {canEdit ? (
                      <input
                        type="number" min="0" step="any" defaultValue={Number(m.qty_needed)} aria-label={`Quantity of ${m.item_code}`}
                        className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-[13px]"
                        onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== Number(m.qty_needed)) save(m, { qtyNeeded: n }); }}
                      />
                    ) : fmtQty(Number(m.qty_needed))}
                    <span className="ml-1 text-[11px] text-ink-muted">{m.uom ?? ""}</span>
                  </td>
                  <td className="px-1 py-2">
                    {canEdit
                      ? <DateField value={m.processing_date ?? ""} onChange={(iso) => save(m, { processingDate: iso || null })} aria-label={`Processing date of ${m.item_code}`} />
                      : fmtDate(m.processing_date)}
                  </td>
                  <td className="px-1 py-2">
                    {canEdit
                      ? <DateField value={m.delivery_date ?? ""} onChange={(iso) => save(m, { deliveryDate: iso || null })} aria-label={`Delivery date of ${m.item_code}`} />
                      : fmtDate(m.delivery_date)}
                  </td>
                  <td className="px-1 py-2"><StatusChip status={statuses.data?.[m.id]} needed={Number(m.qty_needed)} uom={m.uom ?? ""} /></td>
                  <td className="px-1 py-2 text-right">
                    {canEdit && (
                      <button type="button" aria-label={`Remove ${m.item_code}`} onClick={() => void drop(m)} className="text-ink-muted hover:text-err">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {noSkus ? (
        <p className="mt-3 rounded-md border border-border-subtle bg-surface-dim px-3 py-2 text-[13px] text-ink-secondary">
          There are no raw material SKUs yet. Add them in{" "}
          <Link to="/scm/products" className="font-semibold text-primary hover:underline">Procurement &gt; Products</Link>, category Raw material.
        </p>
      ) : canEdit && (
        <div className="mt-3 grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_88px_150px_150px_auto]">
          <SearchableSelect
            value={code}
            onChange={setCode}
            options={(skus.data ?? []).map((s) => ({ value: s.code, label: s.name ? `${s.code} · ${s.name}` : s.code }))}
            placeholder="Pick a raw material"
            ariaLabel="Raw material"
          />
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-right text-[13px]" />
          <DateField value={processingDate} onChange={setProcessingDate} aria-label="Processing date" title="Processing date: when to order it" />
          <DateField value={deliveryDate} onChange={setDeliveryDate} aria-label="Delivery date" title="Delivery date: when it must arrive" />
          <Button variant="secondary" icon={<Plus size={14} />} onClick={addOne} disabled={!code || !(Number(qty) > 0) || add.isPending}>Add</Button>
        </div>
      )}
    </Section>
  );
}
