/* The stock and documents of each sales order line, for the Transfer from Sales Order pickers (owner, 7 Nov 2026):
   is it in stock, which PO, production order, GR and DO hold it, and when an incoming PO is expected to arrive. */

import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { fmtDate } from "@2990s/shared";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import type { TrailStep } from "./RenovationDocTrail";

export interface LineStatus { stock: "stock" | "po" | "shortage" | null; incomingPo: string | null; eta: string | null; steps: TrailStep[] }

export function useSoLineStatus(ids: readonly string[]): Record<string, LineStatus> {
  const key = [...new Set(ids)].sort();
  const q = useQuery({
    queryKey: ["so-line-status", key.join(",")], enabled: key.length > 0, staleTime: 30_000,
    queryFn: async () => {
      const out: Record<string, LineStatus> = {};
      for (let i = 0; i < key.length; i += 300) {
        const r = await authedFetch<{ lines: Record<string, LineStatus> }>(`/renovation-doc-trail/lines?ids=${key.slice(i, i + 300).join(",")}`);
        Object.assign(out, r.lines);
      }
      return out;
    },
  });
  return q.data ?? {};
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
