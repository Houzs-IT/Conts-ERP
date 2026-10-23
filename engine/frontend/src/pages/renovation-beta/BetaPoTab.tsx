/* Beta workspace > PO (owner, 24 Oct 2026): every purchase order line bought for the project's sales order(s), as a
   tree: category, then sub-category, then the lines, each level with its own colour and an open / close toggle (the
   layout of Hookka's BOM tree). Each line: product, SKU, UOM, quantity, area, its PO and date, delivery date, goods
   received (GR) and delivery order (DO). */

import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { WS, WsBadge, WsEmpty, WsPageHead, TONE_ALERT, btnStyle } from "./BetaWsUi";
import { WsMark, WsNarrow, WsNarrowStyle, WsStat, WsStats, WsTable, metaStyle, narrowBandStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonthYear } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";
import { byCategory, voPoApi, type PoLine } from "./renovationBetaVoPo";

/** Level colours: category band, sub-category band. */
const LEVEL = {
  cat: { bg: "#E1F1EE", fg: BETA.accentInk, bar: BETA.accent },
  sub: { bg: "#F3F9F8", fg: WS.text2, bar: "#A9CFCB" },
} as const;

const COLS = 9;

export function BetaPoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "po", p.projectId], () => voPoApi.po(p.projectId), [p.projectId]);
  const tree = useMemo(() => byCategory(q.data?.lines ?? []), [q.data]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  if (q.error) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The purchase orders could not be loaded: {q.error}</p>;
  if (!q.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading PO...</p>;
  const { counts } = q.data;
  const toggle = (key: string): void => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allKeys = tree.flatMap((c) => [c.key, ...c.subs.map((s) => s.key)]);

  return (
    <>
      <WsNarrowStyle />
      <WsPageHead
        title="PO"
        sub="Every purchase order line for this project's sales order, by category."
        right={tree.length > 0 ? (
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btnStyle("outline", "sm")} onClick={() => setClosed(new Set())}>Open all</button>
            <button type="button" style={btnStyle("outline", "sm")} onClick={() => setClosed(new Set(allKeys))}>Close all</button>
          </span>
        ) : undefined}
      />
      <WsStats>
        <WsStat label="Purchase orders" value={counts.pos} meta={counts.cancelled ? `${counts.cancelled} cancelled, not counted` : "Live"} />
        <WsStat label="Lines" value={counts.lines} />
        <WsStat label="Goods received" value={`${counts.received} of ${counts.lines}`} meta="Lines fully received" tone={counts.lines && counts.received === counts.lines ? WS.green : undefined} />
        <WsStat label="Delivered (DO)" value={`${counts.delivered} of ${counts.lines}`} meta="Lines with a delivery order" />
      </WsStats>

      {tree.length === 0 ? <WsEmpty>No purchase order for this project yet.</WsEmpty> : (
        <WsTable minWidth={980} label="Purchase order lines by category">
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>UOM</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
              <th style={thStyle}>Area</th>
              <th style={thStyle}>PO</th>
              <th style={thStyle}>Delivery</th>
              <th style={thStyle}>GR</th>
              <th style={thStyle}>DO</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((c) => {
              const catOpen = !closed.has(c.key);
              return [
                <BandRow key={c.key} level="cat" label={c.label} count={c.count} open={catOpen} onToggle={() => toggle(c.key)} />,
                ...(catOpen ? c.subs.flatMap((s) => {
                  const subOpen = !closed.has(s.key);
                  return [
                    <BandRow key={s.key} level="sub" label={s.label} count={s.items.length} open={subOpen} onToggle={() => toggle(s.key)} />,
                    ...(subOpen ? s.items.map((l) => <LineRow key={l.id} l={l} />) : []),
                  ];
                }) : []),
              ];
            })}
          </tbody>
        </WsTable>
      )}
      {tree.length > 0 && (
        <WsNarrow label="Purchase order lines by category">
          {tree.map((c) => (
            <li key={c.key}>
              <button type="button" aria-expanded={!closed.has(c.key)} onClick={() => toggle(c.key)}
                style={{ ...narrowBandStyle("cat"), width: "100%", borderTop: 0, borderRight: 0, textAlign: "left", font: "inherit", fontWeight: 700, cursor: "pointer", display: "flex", gap: 6, alignItems: "center" }}>
                {closed.has(c.key) ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{c.label} ({c.count})
              </button>
              {!closed.has(c.key) && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {c.subs.map((s) => (
                    <li key={s.key}>
                      <div style={narrowBandStyle("sub")}>{s.label} ({s.items.length})</div>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {s.items.map((l) => (
                          <li key={l.id} style={{ ...narrowItemStyle, opacity: l.poStatus === "CANCELLED" ? 0.6 : 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontWeight: 600 }}>{l.product}</span>
                              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{l.qty} {l.uom}</span>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...metaStyle }}>
                              <span style={{ fontFamily: "ui-monospace, monospace" }}>{l.sku}</span>
                              {l.area && <span>{l.area}</span>}
                              <Link to={`/scm/purchase-orders/${l.poId}`} style={{ fontWeight: 600 }}>{l.poNumber}</Link>
                              <span>{dayMonthYear(l.poDate)}</span>
                              <span>Delivery {dayMonthYear(l.deliveryDate)}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", ...metaStyle }}>
                              GR <WsMark state={l.gr} /> DO <WsMark state={l.delivered ? "yes" : "no"} />
                              {l.poStatus === "CANCELLED" && <WsBadge tone={TONE_ALERT} size={11}>Cancelled</WsBadge>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </WsNarrow>
      )}
    </>
  );
}

function BandRow({ level, label, count, open, onToggle }: { level: "cat" | "sub"; label: string; count: number; open: boolean; onToggle: () => void }): ReactElement {
  const c = LEVEL[level];
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <tr>
      <td colSpan={COLS} style={{ padding: 0, background: c.bg, borderBottom: `1px solid ${BETA.line}` }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 40, padding: `0 10px 0 ${level === "cat" ? 8 : 28}px`, border: 0,
            borderLeft: `4px solid ${c.bar}`, background: "transparent", color: c.fg, font: "inherit", fontSize: level === "cat" ? 15 : 14,
            fontWeight: level === "cat" ? 700 : 600, cursor: "pointer", textAlign: "left",
          }}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          <span style={{ padding: "1px 8px", borderRadius: 10, background: BETA.surface, color: WS.text2, fontSize: 12, fontWeight: 700 }}>{count}</span>
        </button>
      </td>
    </tr>
  );
}

function LineRow({ l }: { l: PoLine }): ReactElement {
  const cancelled = l.poStatus === "CANCELLED";
  return (
    <tr style={cancelled ? { opacity: 0.6 } : undefined}>
      <td style={{ ...tdStyle, paddingLeft: 48 }}>
        {l.product}
        {l.supplierName && <div style={metaStyle}>{l.supplierName}</div>}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{l.sku}</td>
      <td style={tdStyle}>{l.uom}</td>
      <td style={numStyle}>{l.qty}</td>
      <td style={tdStyle}>{l.area ?? "-"}</td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <Link to={`/scm/purchase-orders/${l.poId}`} style={{ fontWeight: 600 }}>{l.poNumber}</Link>
        <div style={metaStyle}>{dayMonthYear(l.poDate)}</div>
        {cancelled && <WsBadge tone={TONE_ALERT} size={11}>Cancelled</WsBadge>}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dayMonthYear(l.deliveryDate)}</td>
      <td style={tdStyle}><WsMark state={l.gr} /></td>
      <td style={tdStyle}><WsMark state={l.delivered ? "yes" : "no"} /></td>
    </tr>
  );
}
