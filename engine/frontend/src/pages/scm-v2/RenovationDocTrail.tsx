/* One order's chain at a glance (owner, 7 Nov 2026): every document of a renovation order shows where the goods are, from
   the sales order through PO, production and GR to the DO, with the arrival or finish date. Nothing shows on a Houzs order.
   27 Nov 2026: one column per stage; several POs or production orders fold into a count and open as a list. */

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import { isOverdue, stagesOf, stepCaption, type TrailKind, type TrailStep, type TrailTone } from "./renovationDocTrailModel";

export type { TrailKind, TrailStep } from "./renovationDocTrailModel";

const LABEL: Readonly<Record<TrailKind, string>> = { so: "Sales order", po: "PO", production: "Production", gr: "GR", do: "DO" };
const hrefOf = (s: TrailStep): string => ({
  so: `/scm/sales-orders/${encodeURIComponent(s.id)}`, po: `/scm/purchase-orders/${s.id}`, production: `/scm/production-orders/${s.id}`,
  gr: `/scm/grns/${s.id}`, do: `/scm/delivery-orders/${s.id}`,
}[s.kind]);
const DOT: Readonly<Record<TrailTone, string>> = { done: "bg-synced", active: "bg-warning-text", wait: "bg-ink-muted", stopped: "bg-err" };
const captionClass = (overdue: boolean): string => (overdue ? "font-medium text-err" : "text-ink-secondary");

export function RenovationDocTrail({ kind, id }: { kind: TrailKind; id: string | undefined | null }): ReactElement | null {
  const [open, setOpen] = useState<TrailKind | null>(null);
  const q = useQuery({
    queryKey: ["renovation-doc-trail", kind, id], enabled: !!id, staleTime: 0, refetchOnMount: "always",
    queryFn: () => authedFetch<{ steps: TrailStep[] }>(`/renovation-doc-trail?kind=${kind}&id=${encodeURIComponent(id ?? "")}`),
  });
  const steps = q.data?.steps ?? [];
  if (steps.length === 0) return null;
  return (
    <section aria-label="Order status" className="mb-3 rounded-lg border border-border bg-surface px-3.5 py-2.5">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Order status</h2>
      <ol className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
        {stagesOf(steps).map((g) => {
          const only = g.steps.at(0);
          const many = g.steps.length > 1;
          const listId = `trail-${g.kind}-list`;
          return (
            <li key={g.kind} className="min-w-0 text-[12.5px] leading-snug">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[g.tone]}`} />
                {many ? `${LABEL[g.kind]} (${g.steps.length})` : LABEL[g.kind]}
              </div>
              {many ? (
                <button type="button" aria-expanded={open === g.kind} aria-controls={listId} onClick={() => setOpen(open === g.kind ? null : g.kind)}
                  className="flex min-h-6 items-center gap-1 whitespace-nowrap font-semibold text-primary hover:underline">
                  {g.steps.length} orders
                  <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open === g.kind ? "rotate-180" : ""}`}><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                </button>
              ) : only ? (
                <Link to={hrefOf(only)} className="block truncate font-semibold text-primary hover:underline">{only.no}</Link>
              ) : null}
              <div className={only ? captionClass(g.overdue) : "text-ink-muted"}>{g.summary}</div>
              {many && open === g.kind && (
                <ul id={listId} className="m-0 mt-1.5 list-none space-y-1 border-l border-border pl-2">
                  {g.steps.map((s) => (
                    <li key={s.id} className="min-w-0">
                      <Link to={hrefOf(s)} className="block truncate font-semibold text-primary hover:underline">{s.no}</Link>
                      <div className={captionClass(isOverdue(s))}>{stepCaption(s)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
