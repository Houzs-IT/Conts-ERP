/* The stock and documents of each sales order line, for the Transfer from Sales Order pickers (owner, 7 Nov 2026):
   is it in stock, which PO, production order, GR and DO hold it, and when an incoming PO is expected to arrive. */

import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { fmtDate } from "@2990s/shared";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import type { TrailStep } from "./RenovationDocTrail";

export interface LineStatus { stock: "stock" | "po" | "shortage" | null; incomingPo: string | null; eta: string | null; steps: TrailStep[] }

/* Asked page by page, in the order the rows are listed, one page after the other: the first rows fill in at once and
   a picker of thousands of lines never waits for all of them (owner, 8 Nov 2026: 5,076 lines on production). */
const PAGE = 150;
export function useSoLineStatus(ids: readonly string[]): Record<string, LineStatus> {
  const pages = useMemo(() => {
    const seen = new Set<string>(); const list: string[] = [];
    for (const id of ids) if (!seen.has(id)) { seen.add(id); list.push(id); }
    const out: string[][] = [];
    for (let i = 0; i < list.length; i += PAGE) out.push(list.slice(i, i + PAGE));
    return out;
  }, [ids]);
  const [answered, setAnswered] = useState(0);
  const results = useQueries({
    queries: pages.map((page, n) => ({
      queryKey: ["so-line-status", page.join(",")],
      staleTime: 30_000,
      queryFn: () => authedFetch<{ lines: Record<string, LineStatus> }>(`/renovation-doc-trail/lines?ids=${page.join(",")}`).then((r) => r.lines),
      // Each page waits for the one before it, so the server is never asked for every page at once.
      enabled: n <= answered,
      retry: 1,
    })),
  });
  const settled = results.findIndex((r) => r.fetchStatus !== "idle" || r.status === "pending");
  const reached = settled === -1 ? pages.length : settled;
  useEffect(() => { if (reached > answered) setAnswered(reached); }, [reached, answered]);
  const data = results.map((r) => r.data);
  return useMemo(() => Object.assign({}, ...data.map((d) => d ?? {})) as Record<string, LineStatus>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one entry per page; the array identity changes every render
    [results.map((r) => r.dataUpdatedAt).join(",")]);
}

const LABEL: Readonly<Record<TrailStep["kind"], string>> = { so: "SO", po: "PO", production: "Production", gr: "GR", do: "DO" };
const TONE: Readonly<Record<TrailStep["tone"], string>> = { done: "#11694a", active: "#b7791f", wait: "#77736b", stopped: "#b42318" };
const STOCK: Readonly<Record<"stock" | "po" | "shortage", { word: string; color: string }>> = {
  stock: { word: "In stock", color: "#11694a" }, po: { word: "Incoming", color: "#b7791f" }, shortage: { word: "Short", color: "#b42318" },
};

export function SoLineStatusCell({ s }: { s: LineStatus | undefined }): ReactElement {
  // Same width while loading: the grid measures its columns on the first paint.
  if (!s) return <div style={{ minWidth: 280, color: "#77736b" }}>…</div>;
  const steps = s.steps.filter((t) => t.kind !== "so");
  const st = s.stock ? STOCK[s.stock] : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, lineHeight: 1.35, whiteSpace: "normal", minWidth: 280 }}>
      {st && (
        <span style={{ color: st.color, fontWeight: 600 }}>
          {st.word}{s.stock === "po" && s.eta ? ` · ETA ${fmtDate(s.eta)}` : ""}
          {s.stock === "po" && s.incomingPo && steps.every((t) => t.no !== s.incomingPo) ? <span style={{ fontWeight: 400, color: "#77736b" }}> ({s.incomingPo})</span> : null}
        </span>
      )}
      {steps.map((t) => (
        <span key={`${t.kind}-${t.id}`}>
          <span style={{ color: "#77736b" }}>{LABEL[t.kind]} </span>
          <b style={{ fontWeight: 600 }}>{t.no}</b>
          <span style={{ color: TONE[t.tone] }}> · {[t.word, t.date ? fmtDate(t.date) : null].filter(Boolean).join(" ")}</span>
        </span>
      ))}
      {!st && steps.length === 0 && <span style={{ color: "#77736b" }}>No PO yet</span>}
    </div>
  );
}

/** Words for search and export, so the column filters like the others. */
export function soLineStatusText(s: LineStatus | undefined): string {
  if (!s) return "";
  const st = s.stock ? `${STOCK[s.stock].word}${s.stock === "po" && s.eta ? ` ETA ${s.eta}` : ""}` : "";
  return [st, ...s.steps.filter((t) => t.kind !== "so").map((t) => `${LABEL[t.kind]} ${t.no} ${t.word}${t.date ? ` ${t.date.slice(0, 10)}` : ""}`)].filter(Boolean).join("; ");
}
