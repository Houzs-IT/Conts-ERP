import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDate } from "@2990s/shared";
import { PodPhotoAlbum } from "../components/scm-v2/PodPhotoAlbum";
import {
  docFilesKey, filesBaseUrl, formatWhen, listDocFiles, refusal, uploadDocFile,
} from "../components/doc-attachments/docAttachmentsApi";

/* The receiving side's twin of the DO's Proof of delivery card (CONTS-0008, Lim Wei Siang 31 Oct 2026: DO and GR
   both carry a POD). Photos taken when the goods arrive (their condition, the supplier's signed delivery order) are
   the GR's attachments with source 'pod'; they also list in Photos & documents, labelled Proof of receipt. */

export type GrnPodFields = { id: string; received_at: string | null; delivery_note_ref: string | null };

export function GrnProofOfReceiptCard({ grn, canEdit }: { grn: GrnPodFields; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = docFilesKey("goods_received", grn.id);
  const q = useQuery({ queryKey: key, queryFn: () => listDocFiles("goods_received", grn.id), staleTime: 30_000 });
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photos = (q.data?.files ?? []).filter((f) => f.source === "pod");
  const paths = photos.map((f) => `${filesBaseUrl("goods_received", grn.id)}/${encodeURIComponent(f.id)}`);
  const last = photos.reduce<(typeof photos)[number] | null>((a, f) => (!a || f.at > a.at ? f : a), null);
  const ready = q.data?.ready !== false;

  const take = async (picked: File[]) => {
    if (!picked.length) return;
    const refused = picked.map(refusal).find(Boolean);
    if (refused) { setError(refused); return; }
    setBusy(true);
    setError(null);
    try {
      for (const f of picked) await uploadDocFile("goods_received", grn.id, f, { source: "pod", caption: "Proof of receipt" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const rows: Array<[string, string | null]> = [
    ["Received", grn.received_at ? fmtDate(grn.received_at) : null],
    ["Supplier DO", grn.delivery_note_ref],
    ["Photo taken", last ? [last.by, formatWhen(last.at)].filter(Boolean).join(" · ") : null],
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-stone">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Proof of receipt</span>
        {canEdit && ready && (
          <button type="button" disabled={busy} onClick={() => camera.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-primary disabled:opacity-60">
            <Camera size={14} aria-hidden="true" />
            {busy ? "Uploading..." : photos.length ? "Add photo" : "Take photo"}
          </button>
        )}
        <input ref={camera} type="file" accept="image/*,.heic,.heif" capture="environment" multiple className="hidden"
          onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void take(picked); }} />
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-border-subtle py-2 last:border-b-0">
          <span className="text-[12.5px] text-ink-muted">{k}</span>
          <span className={v ? "text-[13px] font-semibold tabular-nums text-ink" : "text-[13px] font-semibold text-ink-muted"}>{v ?? "—"}</span>
        </div>
      ))}
      <div className="mt-3">
        <PodPhotoAlbum paths={paths} fileStem={`GR-POD-${grn.id.slice(0, 8)}`}
          emptyText={q.isPending ? undefined : "No photo yet. Take one of the goods and the supplier's signed delivery order when they arrive."} />
      </div>
      {error && <div className="mt-2 text-[12.5px] text-err">{error}</div>}
    </div>
  );
}
