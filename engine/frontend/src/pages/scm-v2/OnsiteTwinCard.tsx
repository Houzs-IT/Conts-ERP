/* The other half of an On-site receipt or delivery (owner, 6 Nov 2026): which PO a delivery goes with, what was raised
   with it, and a retry if that second step did not finish. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useOnsiteTwin, syncOnsiteTwin } from "../../vendor/scm/lib/onsite-twin-queries";

export function OnsiteTwinCard({ kind, id, confirmed }: { kind: "grn" | "do"; id: string; confirmed: boolean }) {
  const q = useOnsiteTwin(kind, id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = q.data;
  if (!t?.onSite) return null;
  const linkTo = kind === "grn" ? "/scm/delivery-orders" : "/scm/grns";
  const canRaise = confirmed && t.linked.length === 0;
  return (
    <div className="mb-3 rounded-lg border border-border bg-surface px-4 py-3 text-[12.5px]">
      <div className="font-semibold text-ink">On site: received and delivered together</div>
      {t.pos && t.pos.length > 0 && <div className="mt-1 text-ink-secondary">Goes with {t.pos.join(", ")}</div>}
      {t.linked.length > 0
        ? <div className="mt-1 text-ink-secondary">{kind === "grn" ? "Delivery order" : "Goods receipt"}: {t.linked.map((l, i) => (
          <span key={l.id}>{i > 0 && ", "}<Link className="underline" to={`${linkTo}/${l.id}`}>{l.no}</Link></span>
        ))}</div>
        : <div className="mt-1 text-ink-secondary">{confirmed ? "Nothing raised with this one yet." : `Confirming this raises the ${kind === "grn" ? "delivery order" : "goods receipt"}.`}</div>}
      {canRaise && (kind === "grn" || t.open) && (
        <button type="button" disabled={busy} className="mt-2 text-[12px] font-semibold text-primary underline disabled:opacity-50"
          onClick={() => {
            setBusy(true); setError(null);
            syncOnsiteTwin(kind, id).catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong.")).finally(() => { setBusy(false); void q.refetch(); });
          }}>
          {busy ? "Working…" : `Raise the ${kind === "grn" ? "delivery order" : "goods receipt"}`}
        </button>
      )}
      {error && <div className="mt-1 text-err">{error}</div>}
    </div>
  );
}
