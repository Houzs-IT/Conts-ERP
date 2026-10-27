/* The GR and DO cells the PO and Client PO tabs share (owner, 24 Oct 2026: the two tabs are twins): the goods receipt
   or delivery order that carried a line, as a link to its row in the GR or DO tab, with its date. */

import { useCallback, type CSSProperties, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { WS } from "./BetaWsUi";
import { metaStyle } from "./BetaVoPoUi";
import type { LineDoc } from "./renovationBetaDocsModel";
import { dayMonth, dayMonthYear, mytDay } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

export type DocTab = "do" | "gr";

/** Opens the DO or GR tab on one document's row (BetaDocTabs.tsx reads ?do= / ?gr=). */
export function useOpenDoc(): (tab: DocTab, no: string) => void {
  const [, setParams] = useSearchParams();
  return useCallback((tab: DocTab, no: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set("tab", tab);
    next.delete(tab === "do" ? "gr" : "do");
    next.set(tab, no);
    return next;
  }), [setParams]);
}

/** A GR or DO cell: the document that carried the line, as a link to it in its tab, and when; "Not yet" before one
    exists; "-" where none is expected (a line the client buys has no GR). */
export function DocCell({ docs, state, tab, open }: { docs: readonly LineDoc[]; state: "yes" | "part" | "no" | null; tab: DocTab; open: (tab: DocTab, no: string) => void }): ReactElement {
  const what = tab === "do" ? "Delivery order" : "Goods received";
  if (docs.length === 0) return state ? <span style={{ ...metaStyle, fontSize: 12 }}>Not yet</span> : <span style={metaStyle} aria-label={`${what}: not applicable`}>-</span>;
  const first = docs[0];
  const all = docs.map((x) => `${x.no} (${x.qty})${x.at ? ` on ${dayMonthYear(mytDay(x.at))}` : ""}`).join(", ");
  return (
    <button type="button" onClick={() => open(tab, first.no)} title={`${what}: ${all}${state === "part" ? ". Part of the quantity so far" : ""}. Open it`}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", minWidth: 0, padding: 0, border: 0, background: "transparent", font: "inherit", textAlign: "left", cursor: "pointer" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 3, maxWidth: "100%", fontSize: 12, fontWeight: 600, color: BETA.accentInk }}>
        <Check size={12} aria-hidden="true" style={{ flex: "none", color: state === "part" ? WS.amber : WS.green }} /><span style={{ ...ellipsis, textDecoration: "underline", textDecorationColor: `${BETA.accent}66`, textUnderlineOffset: 2 }}>{first.no}</span>
      </span>
      <span style={{ fontSize: 11, color: state === "part" ? WS.amber : BETA.muted, maxWidth: "100%", ...ellipsis }}>
        {[first.at ? dayMonth(mytDay(first.at)) : null, state === "part" ? "Part" : null, docs.length > 1 ? `+${docs.length - 1} more` : null].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

