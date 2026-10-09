/* Proof of delivery on a goods receipt that was taken at the customer's unit
   (renovation site receipt). Renders nothing for an ordinary warehouse receipt. */

import { Link } from "react-router-dom";
import { MapPin, Printer } from "lucide-react";
import { api } from "../../../api/client";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi } from "./renovationApi";
import { AuthImage } from "./renovationUi";

export function SiteReceiptPanel({ grnId }: { grnId: string | undefined }) {
  const q = useQuery(["renovation", "site-receipt", grnId ?? ""], () => renovationApi.siteReceiptDetail(grnId!), [grnId], { enabled: !!grnId });
  if (!q.data) return null;
  const r = q.data.receipt as {
    project_id: number; site_received_at: string | null; site_lat: number | null; site_lng: number | null; site_accuracy_m: number | null;
    supervisor_name: string | null; customer_signer_name: string | null; supervisor_signature_r2_key: string | null; customer_signature_r2_key: string | null; site_notes: string | null;
  };
  const pid = Number(r.project_id);
  const when = r.site_received_at ? new Date(r.site_received_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : "-";
  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Received on site</h3>
        <div className="flex gap-3 text-sm">
          <Link className="text-primary" to={`/projects/${pid}`}>Open project</Link>
          <button type="button" className="text-primary inline-flex items-center gap-1" onClick={() => void api.openHtml(`/api/renovation/${pid}/pod/print?grnId=${encodeURIComponent(grnId!)}`)}><Printer size={14} />Print note</button>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">No stock was booked: the goods are in the customer's unit.</p>
      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-ink-secondary">Received</dt><dd>{when}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Location</dt><dd className="inline-flex items-center gap-1"><MapPin size={12} />{r.site_lat != null && r.site_lng != null ? `${Number(r.site_lat).toFixed(5)}, ${Number(r.site_lng).toFixed(5)}${r.site_accuracy_m != null ? ` (±${Math.round(Number(r.site_accuracy_m))} m)` : ""}` : "Not captured"}</dd></div>
        <div><dt className="text-xs text-ink-secondary">Site supervisor</dt><dd>{r.supervisor_name ?? "-"} (signed)</dd></div>
        <div><dt className="text-xs text-ink-secondary">Customer</dt><dd>{r.customer_signer_name ? `${r.customer_signer_name} (signed)` : "Not signed"}</dd></div>
        {r.site_notes && <div className="sm:col-span-2"><dt className="text-xs text-ink-secondary">Notes</dt><dd>{r.site_notes}</dd></div>}
      </dl>
      {q.data.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {q.data.photos.map((p) => (
            <figure key={p.id}>
              <AuthImage path={renovationApi.fileUrl(pid, p.r2_key)} alt={p.kind} className="h-20 w-full rounded" />
              <figcaption className="text-[11px] text-ink-secondary truncate">{p.kind.replace("_", " ")}{p.location ? ` · ${p.location}` : ""}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {r.supervisor_signature_r2_key && <AuthImage path={renovationApi.fileUrl(pid, r.supervisor_signature_r2_key)} alt="Supervisor signature" className="h-16 w-full rounded border border-border bg-white object-contain" />}
        {r.customer_signature_r2_key && <AuthImage path={renovationApi.fileUrl(pid, r.customer_signature_r2_key)} alt="Customer signature" className="h-16 w-full rounded border border-border bg-white object-contain" />}
      </div>
    </section>
  );
}
