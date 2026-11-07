/* One order's chain at a glance (owner, 7 Nov 2026): every document of a renovation order shows where the goods are, from
   the sales order through PO, production and GR to the DO, with the arrival or finish date. Nothing shows on a Houzs order. */

import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { fmtDate } from "@2990s/shared";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";

export type TrailKind = "so" | "po" | "production" | "gr" | "do";
export interface TrailStep { kind: TrailKind; id: string; no: string; word: string; tone: "done" | "active" | "wait" | "stopped"; date: string | null; who: string | null }

const LABEL: Readonly<Record<TrailKind, string>> = { so: "Sales order", po: "PO", production: "Production", gr: "GR", do: "DO" };
const hrefOf = (s: TrailStep): string => ({
  so: `/scm/sales-orders/${encodeURIComponent(s.id)}`, po: `/scm/purchase-orders/${s.id}`, production: `/scm/production-orders/${s.id}`,
  gr: `/scm/grns/${s.id}`, do: `/scm/delivery-orders/${s.id}`,
}[s.kind]);
const DOT: Readonly<Record<TrailStep["tone"], string>> = { done: "#11694a", active: "#b7791f", wait: "#b9b5ad", stopped: "#b42318" };

export function RenovationDocTrail({ kind, id }: { kind: TrailKind; id: string | undefined | null }): ReactElement | null {
  const q = useQuery({
    queryKey: ["renovation-doc-trail", kind, id], enabled: !!id, staleTime: 15_000,
    queryFn: () => authedFetch<{ steps: TrailStep[] }>(`/renovation-doc-trail?kind=${kind}&id=${encodeURIComponent(id ?? "")}`),
  });
  const steps = q.data?.steps ?? [];
  if (steps.length === 0) return null;
  const missing = (["po", "production", "gr", "do"] as const).filter((k) => !steps.some((s) => s.kind === k));
  return (
    <section aria-label="Order status" className="mb-3 rounded-lg border border-border-subtle bg-surface-1 px-3.5 py-2.5">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Order status</h2>
      <ol className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {steps.map((s) => (
          <li key={`${s.kind}-${s.id}`} className="min-w-0 text-[12.5px] leading-snug">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-muted"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[s.tone] }} />{LABEL[s.kind]}</div>
            <Link to={hrefOf(s)} className="font-semibold text-primary hover:underline">{s.no}</Link>
            <div className="text-ink-secondary">{[s.word, s.date ? fmtDate(s.date) : null].filter(Boolean).join(" ")}</div>
          </li>
        ))}
        {missing.map((k) => (
          <li key={k} className="text-[12.5px] leading-snug text-ink-muted">
            <div className="flex items-center gap-1.5 text-[11px]"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: DOT.wait }} />{LABEL[k]}</div>
            <div>Not yet</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
