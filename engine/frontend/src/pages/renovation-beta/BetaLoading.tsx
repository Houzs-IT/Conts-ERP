/* What Beta shows while a screen loads: grey shapes where the cards will be, with a light that sweeps across them.
   It carries its own style tag because the screens that wait have not drawn their stylesheet yet. With "reduce motion" on,
   the shapes stay still. It says what is loading to a screen reader. */

import type { CSSProperties, ReactElement } from "react";
import { BETA, GLASS } from "./renovationBetaTheme";

export type BetaLoadingSize = "page" | "section" | "inline";

const CSS = `
.bload .bar{position:relative;overflow:hidden;border-radius:8px;background:${BETA.chip}}
@media (prefers-reduced-motion:no-preference){
.bload .bar::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,${BETA.row},transparent);animation:bload 1.4s ease-in-out infinite}
@keyframes bload{from{transform:translateX(-100%)}to{transform:translateX(100%)}}}`;

const SR: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

function Bar({ w, h = 12 }: { w: string; h?: number }): ReactElement {
  return <div className="bar" style={{ width: w, height: h }} />;
}

function Card({ rows }: { rows: ReadonlyArray<string> }): ReactElement {
  return (
    <div style={{ ...GLASS, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <Bar w="34%" h={16} />
      {rows.map((w, i) => <Bar key={i} w={w} />)}
    </div>
  );
}

const CARDS: Record<Exclude<BetaLoadingSize, "inline">, ReadonlyArray<ReadonlyArray<string>>> = {
  page: [["70%", "55%"], ["92%", "80%", "64%"], ["88%", "72%", "48%"]],
  section: [["92%", "78%", "60%"], ["84%", "66%"]],
};

export function BetaLoading({ label, size = "section" }: { label: string; size?: BetaLoadingSize }): ReactElement {
  return (
    <div className="bload" role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: size === "inline" ? 8 : 16, padding: size === "page" ? "24px 0" : size === "inline" ? "4px 0" : "8px 0" }}>
      <style>{CSS}</style>
      <span style={SR}>{label}</span>
      {size === "inline" ? <><Bar w="60%" /><Bar w="40%" /></> : CARDS[size].map((rows, i) => <Card key={i} rows={rows} />)}
    </div>
  );
}
