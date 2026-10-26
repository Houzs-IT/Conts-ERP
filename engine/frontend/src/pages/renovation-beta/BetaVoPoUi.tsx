/* Pieces the VO, PO and Client PO tabs share: the number tiles, the table frame that scrolls inside its card on a
   narrow screen, and the yes / part / no marks. Colours are the Beta palette (renovationBetaTheme.ts, BetaWsUi.tsx). */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { WS } from "./BetaWsUi";
import { BETA, TONES } from "./renovationBetaTheme";

export const thStyle: CSSProperties = {
  textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: WS.text2, background: WS.head, borderBottom: `1px solid ${BETA.line}`,
  whiteSpace: "nowrap", position: "sticky", top: 0,
};
export const tdStyle: CSSProperties = { padding: "8px 10px", fontSize: 14, borderBottom: `1px solid ${WS.rowLine}`, verticalAlign: "top" };
export const numStyle: CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
export const metaStyle: CSSProperties = { fontSize: 12, color: BETA.muted };

/* Below 640px a table becomes a list of stacked rows (WsNarrow), so a phone sees every figure without scrolling sideways. */
const NARROW_CSS = `.bws .bvo-wide{display:block}.bws .bvo-narrow{display:none}@media (max-width:640px){.bws .bvo-wide{display:none}.bws .bvo-narrow{display:flex}}`;

export function WsNarrowStyle(): ReactElement {
  return <style>{NARROW_CSS}</style>;
}

/** The phone layout of a table: one bordered list, one block per line. */
export function WsNarrow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <ul className="bvo-narrow" aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0, flexDirection: "column", border: `1px solid ${BETA.line}`, borderRadius: 10, overflow: "hidden" }}>
      {children}
    </ul>
  );
}

export const narrowItemStyle: CSSProperties = { padding: "10px 12px", borderBottom: `1px solid ${WS.rowLine}`, display: "flex", flexDirection: "column", gap: 4, background: BETA.surface };
export const narrowBandStyle = (level: "cat" | "sub"): CSSProperties => ({
  padding: level === "cat" ? "8px 12px" : "6px 12px 6px 20px", background: level === "cat" ? TONES.accent.soft : BETA.tealSoft,
  borderLeft: `4px solid ${level === "cat" ? BETA.accent : TONES.accent.line}`, color: level === "cat" ? BETA.accentInk : WS.text2, fontWeight: level === "cat" ? 700 : 600,
  fontSize: level === "cat" ? 15 : 14, borderBottom: `1px solid ${BETA.line}`,
});

/** A table that keeps its columns and scrolls sideways inside its card when the screen is narrower than it. */
export function WsTable({ minWidth, label, children }: { minWidth: number; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="bvo-wide" role="region" aria-label={label} tabIndex={0} style={{ width: "100%", overflowX: "auto", border: `1px solid ${BETA.line}`, borderRadius: 10 }}>
      <table style={{ width: "100%", minWidth, borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

/** A number tile: label, big figure, meta line. */
export function WsStat({ label, value, meta, tone }: { label: string; value: ReactNode; meta?: ReactNode; tone?: string }): ReactElement {
  return (
    <div style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 13, color: BETA.muted }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: tone ?? BETA.ink, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{value}</div>
      {meta != null && <div style={{ marginTop: 2, ...metaStyle }}>{meta}</div>}
    </div>
  );
}

export function WsStats({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>{children}</div>;
}

/** Yes (green), part (amber), no (grey). */
export function WsMark({ state, yes = "Yes", part = "Part", no = "No" }: { state: "yes" | "part" | "no"; yes?: string; part?: string; no?: string }): ReactElement {
  const [fg, bg, text] = state === "yes" ? [WS.green, TONES.accent.soft, yes] : state === "part" ? [WS.amber, TONES.amber.soft, part] : [WS.text2, WS.chip, no];
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, background: bg, color: fg, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{text}</span>;
}
