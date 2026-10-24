/* Delivery order > "Mark delivered" for office staff (Conts, owner run 24 Oct 2026). Houzs closes a delivery on the
   driver's Proof-of-Delivery phone screen; Conts has no driver app, so every DO stayed "Ready to dispatch". This
   runs the SAME delivered transition (PATCH /delivery-orders-mfg/:id/status DELIVERED) with the day it arrived and
   optional photos: the first photo is the proof of delivery (the phone POD's upload and column), any more go on
   the DO's files with the caption "Proof of delivery". */
import { useState, type ReactElement } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { ModalOverlay } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { uploadSlipFull } from "../../vendor/scm/lib/slip";
import { useUpdateMfgDeliveryOrderStatus } from "../../vendor/scm/lib/delivery-order-queries";
import { refusal, uploadDocFile } from "../../components/doc-attachments/docAttachmentsApi";
import { useQueryClient } from "@tanstack/react-query";

/** Conts switch: office staff may mark a delivery done. */
export const CONTS_OFFICE_MARK_DELIVERED = true as boolean;

/** Statuses a delivery can be marked delivered from: shipped, not yet delivered. */
const OPEN_SHIPPED = new Set(["LOADED", "DISPATCHED", "IN_TRANSIT", "SIGNED"]);

export function canMarkDelivered(status: string | null | undefined): boolean {
  return CONTS_OFFICE_MARK_DELIVERED && OPEN_SHIPPED.has(String(status ?? "").trim().toUpperCase());
}

const todayMyt = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export function MarkDeliveredButton({ doId, doNumber, status, phone = false }: {
  doId: string; doNumber: string; status: string | null | undefined; phone?: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!canMarkDelivered(status)) return null;
  return (
    <>
      {phone ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-[13.5px] font-bold text-ink hover:bg-surface-dim"
        >
          <PackageCheck size={16} /> Mark delivered
        </button>
      ) : (
        <Button variant="secondary" icon={<PackageCheck size={14} />} onClick={() => setOpen(true)}>
          Mark delivered
        </Button>
      )}
      {open && <MarkDeliveredDialog doId={doId} doNumber={doNumber} onClose={() => setOpen(false)} />}
    </>
  );
}

function MarkDeliveredDialog({ doId, doNumber, onClose }: { doId: string; doNumber: string; onClose: () => void }): ReactElement {
  const qc = useQueryClient();
  const update = useUpdateMfgDeliveryOrderStatus();
  const today = todayMyt();
  const [day, setDay] = useState(today);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const bad = picked.map(refusal).find(Boolean) ?? null;
    setError(bad);
    if (!bad) setFiles(picked);
  };

  const submit = async () => {
    if (!day || day > today) { setError("Pick the day the goods arrived (not a future day)."); return; }
    setBusy(true);
    setError(null);
    try {
      /* The photo is stored BEFORE the status flips, the phone POD's order: a delivery is never marked done on a
         photo that did not save. */
      let podKey: string | undefined;
      if (files[0]) podKey = (await uploadSlipFull({ file: files[0] })).r2Key;
      await update.mutateAsync({ id: doId, status: "DELIVERED", evidence: { podKey, deliveredOn: day } });
      const failed: string[] = [];
      for (const f of files.slice(1)) {
        try { await uploadDocFile("delivery_order", doId, f, { caption: "Proof of delivery" }); } catch { failed.push(f.name); }
      }
      void qc.invalidateQueries({ queryKey: ["doc-attachments", "delivery_order", doId] });
      if (failed.length) { setError(`Marked delivered. These photos did not upload: ${failed.join(", ")}. Add them under Files.`); setBusy(false); return; }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark it delivered. Please try again.");
      setBusy(false);
    }
  };

  return (
    <ModalOverlay
      open
      onClose={busy ? () => {} : onClose}
      title={`Mark ${doNumber} delivered`}
      icon={<PackageCheck size={16} />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? "Saving..." : "Mark delivered"}</Button>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]">
        <p className="text-ink-secondary">The goods reached the site. The sales order shows them as delivered.</p>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink">Delivered on</span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => setDay(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-[14px] text-ink"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink">Proof of delivery photos (optional)</span>
          <input type="file" accept="image/*,.heic,.heif,application/pdf" multiple onChange={(e) => pick(e.target.files)} className="block w-full text-[13px]" />
          {files.length > 0 && <span className="mt-1 block text-[12px] text-ink-muted">{files.length} photo{files.length === 1 ? "" : "s"} chosen</span>}
        </label>
        {error && <p role="alert" className="text-[12.5px] font-medium text-danger">{error}</p>}
      </div>
    </ModalOverlay>
  );
}
