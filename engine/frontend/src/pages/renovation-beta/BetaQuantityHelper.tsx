/* PO tab > Quantity helper: the deck's quantity rules (ID SOP slides 12 to 16) as a small calculator. It only calculates;
   it writes nothing to the sales order, a VO or a PO, so anyone who can see the tab can use it. Rules live in
   renovationBetaQuantities.ts. Plan: PLAN-quantity-calculators.md. */

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { WS, WsDialog, WsField, WsFilterPill, btnStyle, inputStyle } from "./BetaWsUi";
import {
  PAINT_BRANDS, QTY, ledStrip, lBoxes, nonNegative, partition, plasterCeiling, positive, trackLight, wallPaint, type PaintTins,
} from "./renovationBetaQuantities";
import { BETA } from "./renovationBetaTheme";

type TabKey = "plaster" | "paint" | "track" | "led";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "plaster", label: "Plaster ceiling" },
  { key: "paint", label: "Wall paint" },
  { key: "track", label: "Track light" },
  { key: "led", label: "LED strip" },
];

const CUSTOM = "custom";
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 };
const box: CSSProperties = { border: `1px solid ${BETA.line}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10, background: WS.panel };

function Num({ label, value, set, unit }: { label: string; value: string; set: (v: string) => void; unit: string }): ReactElement {
  return (
    <WsField label={`${label} (${unit})`}>
      <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} style={inputStyle} />
    </WsField>
  );
}

function Out({ rows, empty }: { rows: ReadonlyArray<[string, ReactNode]> | null; empty: string }): ReactElement {
  if (!rows) return <div style={{ fontSize: 13, color: BETA.muted }}>{empty}</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderTop: `1px solid ${BETA.lineSoft}` }}>
            <td style={{ padding: "6px 0", color: WS.text2 }}>{k}</td>
            <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700 }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tinsText = (t: PaintTins): string =>
  [t.l20 && `${t.l20} x 20 L`, t.l5 && `${t.l5} x 5 L`, t.l1 && `${t.l1} x 1 L`].filter(Boolean).join(" + ") || "0";

function Plaster(): ReactElement {
  const [area, setArea] = useState("");
  const [len, setLen] = useState("");
  const [pArea, setPArea] = useState("");
  const [pCount, setPCount] = useState("");
  const a = positive(area);
  const l = positive(len);
  const pa = positive(pArea);
  const pc = positive(pCount);
  const ceiling = a === null ? null : plasterCeiling(a);
  const part = pa === null || pc === null ? null : partition(pa, pc);
  return (
    <>
      <div style={box}>
        <b style={{ fontSize: 14 }}>Plaster ceiling</b>
        <div style={grid}>
          <Num label="Ceiling area" value={area} set={setArea} unit="sqft" />
          <Num label="L box total length" value={len} set={setLen} unit="ft" />
        </div>
        <Out empty="Enter the ceiling area." rows={ceiling && [
          ["Ceiling boards (4' x 8')", ceiling.boards],
          ["Tees", ceiling.tees],
          ...(l === null ? [] : [["L boxes (8 ft each)", lBoxes(l)] as [string, ReactNode]]),
        ]} />
      </div>
      <div style={box}>
        <b style={{ fontSize: 14 }}>Partition</b>
        <div style={grid}>
          <Num label="Left + right + front area" value={pArea} set={setPArea} unit="sqft" />
          <Num label="Number of partitions" value={pCount} set={setPCount} unit="count" />
        </div>
        <Out empty="Enter the area and the number of partitions." rows={part && [
          ["Partition boards", part.boards],
          ["Channels", part.channels],
          ["Corner beads", part.cornerBeads],
        ]} />
      </div>
    </>
  );
}

function Paint(): ReactElement {
  const [perimeter, setPerimeter] = useState("");
  const [height, setHeight] = useState("");
  const [openings, setOpenings] = useState("0");
  const [brand, setBrand] = useState<string>(PAINT_BRANDS[0].id);
  const [custom, setCustom] = useState("");
  const [coats, setCoats] = useState(String(QTY.defaultCoats));
  const [spare, setSpare] = useState(String(QTY.defaultSparePct));
  const cover = brand === CUSTOM ? positive(custom) : PAINT_BRANDS.find((b) => b.id === brand)?.sqftPerLitre ?? null;
  const [p, h, o, c, s] = [positive(perimeter), positive(height), nonNegative(openings), positive(coats), nonNegative(spare)];
  const ready = p !== null && h !== null && o !== null && cover !== null && c !== null && s !== null;
  const r = ready ? wallPaint({ perimeterFt: p, heightFt: h, openingsSqft: o, sqftPerLitre: cover, coats: c, sparePct: s }) : null;
  return (
    <div style={box}>
      <div style={grid}>
        <Num label="Room perimeter" value={perimeter} set={setPerimeter} unit="ft" />
        <Num label="Ceiling height" value={height} set={setHeight} unit="ft" />
        <Num label="Doors and windows" value={openings} set={setOpenings} unit="sqft" />
        <WsField label="Paint">
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle}>
            {PAINT_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label} ({b.sqftPerLitre} sqft/L)</option>)}
            <option value={CUSTOM}>Other (type the coverage)</option>
          </select>
        </WsField>
        {brand === CUSTOM && <Num label="Coverage" value={custom} set={setCustom} unit="sqft per litre" />}
        <Num label="Coats" value={coats} set={setCoats} unit="count" />
        <Num label="Spare" value={spare} set={setSpare} unit="%" />
      </div>
      <div style={{ fontSize: 12, color: BETA.muted }}>Several rooms with the same height: add their perimeters together. Coverage is the real-world figure (official x 0.8).</div>
      {ready && !r
        ? <div style={{ fontSize: 13, color: WS.red }}>The doors and windows are as big as the walls. Check the numbers.</div>
        : <Out empty="Enter the perimeter and the ceiling height." rows={r && [
          ["Net wall area", `${Math.round(r.netWallSqft)} sqft`],
          ["Paint needed", `${r.litres.toFixed(1)} L`],
          ["Tins to buy", tinsText(r.tins)],
        ]} />}
    </div>
  );
}

function Track(): ReactElement {
  const [len, setLen] = useState("");
  const l = positive(len);
  const r = l === null ? null : trackLight(l);
  const pieces = r && [r.fullPieces ? `${r.fullPieces} x ${QTY.trackPieceM} m` : "", r.remainderM ? `1 x ${r.remainderM} m` : ""].filter(Boolean).join(" + ");
  return (
    <div style={box}>
      <div style={grid}><Num label="Track length (one run)" value={len} set={setLen} unit="m" /></div>
      <div style={{ fontSize: 12, color: BETA.muted }}>A long track cannot be shipped in one piece, so it is bought in 2 m pieces and joined on site. Only 3 m (2 m + 1 m, 1 connector, 1 driver) is confirmed; check longer runs with your supervisor.</div>
      <Out empty="Enter the track length." rows={r && [
        ["Track pieces to buy", pieces],
        ["Connectors", r.connectors],
        ["Driver (100 W)", r.drivers],
      ]} />
    </div>
  );
}

function Led(): ReactElement {
  const [len, setLen] = useState("");
  const l = positive(len);
  const r = l === null ? null : ledStrip(l);
  return (
    <div style={box}>
      <div style={grid}><Num label="Strip length" value={len} set={setLen} unit="m" /></div>
      <div style={{ fontSize: 12, color: BETA.muted }}>A roll is 5 m and one 100 W driver holds 5 m, so each roll needs its own driver.</div>
      <Out empty="Enter the strip length." rows={r && [
        ["COB strip rolls (5 m)", r.rolls],
        ["Drivers (100 W)", r.drivers],
      ]} />
    </div>
  );
}

export function BetaQuantityHelper({ onClose }: { onClose: () => void }): ReactElement {
  const [tab, setTab] = useState<TabKey>("plaster");
  return (
    <WsDialog
      title="Quantity helper"
      sub="Works out what to order from the ID SOP rules. It only calculates; nothing is saved to the order."
      onClose={onClose}
      wide
      footer={<button type="button" style={btnStyle("outline")} onClick={onClose}>Close</button>}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((t) => <WsFilterPill key={t.key} on={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</WsFilterPill>)}
      </div>
      {tab === "plaster" && <Plaster />}
      {tab === "paint" && <Paint />}
      {tab === "track" && <Track />}
      {tab === "led" && <Led />}
    </WsDialog>
  );
}
