/* The work done on a project (owner, 6 Nov 2026): Production Order is the truth for Works, so a completed order's photos show
   here, read from the order and never copied. Someone with no access to production orders simply does not see the panel. */

import { useQuery } from "@tanstack/react-query";
import { fmtDate } from "@2990s/shared";
import { Link } from "react-router-dom";
import { DocAttachments } from "../../../components/doc-attachments/DocAttachments";
import { authedFetch } from "../../../vendor/scm/lib/authed-fetch";

type Linked = { id: string; po_number: string; status: string; received_at: string | null };

export function RenovationWorksDone({ projectId }: { projectId: number }) {
  const q = useQuery({
    queryKey: ["project-production-orders", projectId],
    queryFn: () => authedFetch<{ productionOrders: Linked[] }>(`/production-orders/links?projectId=${projectId}`).then((r) => r.productionOrders),
    staleTime: 30_000,
    retry: false,
  });
  const done = (q.data ?? []).filter((o) => o.status === "RECEIVED");
  if (done.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-stone">
      <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Work done · {done.length}</h2>
      {done.map((o) => (
        <div key={o.id} className="border-t border-border-subtle py-2 first:border-t-0">
          <div className="mb-1.5 flex justify-between gap-2 text-[13px]">
            <Link to={`/scm/production-orders/${o.id}`} className="font-semibold text-primary hover:underline">{o.po_number}</Link>
            {o.received_at && <span className="text-ink-muted">Completed {fmtDate(o.received_at)}</span>}
          </div>
          <DocAttachments docType="production_order" docId={o.id} canEdit={false} bare />
        </div>
      ))}
    </section>
  );
}
