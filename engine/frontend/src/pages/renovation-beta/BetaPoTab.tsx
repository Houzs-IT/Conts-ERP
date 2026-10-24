/* Beta workspace > PO (owner, 24 Oct 2026): the project's line manager. Every current line of its sales order(s),
   after VOs, by category: SKU, description, variants, qty, amount, when to order, when to deliver, and whether the goods
   were received (GR) and delivered (DO).

   The pale yellow fields change the line. "Save & post to VO" applies every change to the sales order at once and
   keeps it as one VO per order (no approval: renovationBetaLines.ts postVo). The dates are not VOs: on a line a PO
   holds they change the PO itself; before that they are the plan. A PO a VO changed is flagged until purchasing
   confirms the PO change. */

import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Download, FilePlus2, Search } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { useMfgProducts } from "../../vendor/scm/lib/mfg-products-queries";
import { money } from "../projects/renovation/renovationModel";
import { WS, WsBadge, WsDialog, WsEmpty, WsFilterPill, WsPageHead, TONE_ALERT, TONE_QUIET, TONE_WAIT, btnStyle, inputStyle } from "./BetaWsUi";
import { WsMark, WsNarrow, WsNarrowStyle, WsStat, WsStats, WsTable, metaStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonthYear } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";
import { voPoApi } from "./renovationBetaVoPo";
import { LinePhotoThumbs, type LinePhotoSet } from "./BetaLinePhotos";
import {
  amountAfter, byAreaBlocks, byCategory, livePo, colourEditable, colourOf, editProblem, editWords, effectiveEdit, lineDates, lineLate, linesApi, linesCsv, postVo, refusalText,
  voBatches, type LineEdit, type ManagedLine, type PendingPoChange, type PostedVo,
} from "./renovationBetaLines";

/** One colour per category band, in the mockup's spirit: [bar, band background, text]. */
const BANDS: ReadonlyArray<readonly [string, string, string]> = [
  ["#1A6B66", "#E1F1EE", "#0F4A46"],
  ["#B4540A", "#FFF1E0", "#7A3906"],
  ["#1F4E8C", "#E8F0FB", "#163A69"],
  ["#7A3E9D", "#F3EAF8", "#552B6E"],
  ["#2E7D32", "#E7F3E8", "#1E5420"],
  ["#A12622", "#FBEAE9", "#741B18"],
];

const EDIT_BG = "#FFF9DB";
const EDIT_LINE = "#E9D77E";
const editInput: CSSProperties = { ...inputStyle, minHeight: 34, fontSize: 13, background: EDIT_BG, borderColor: EDIT_LINE, padding: "0 8px" };
const dateInput: CSSProperties = { ...editInput, width: 132, padding: "0 4px" };
const COLS = 10;

type DateField = "orderOn" | "deliverOn" | "poDate";

export function BetaPoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "lines", p.projectId], () => linesApi.lines(p.projectId), [p.projectId]);
  const vo = useQuery(["renovation-beta", "vo", p.projectId], () => voPoApi.vo(p.projectId), [p.projectId]);
  const { can } = useAuth();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [picking, setPicking] = useState<ManagedLine | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PostedVo[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const lines = q.data?.lines ?? [];
  const [view, setView] = useState<"category" | "area">("category");
  const tree = useMemo(() => (view === "area" ? byAreaBlocks(lines) : byCategory(lines)), [lines, view]);
  const batches = useMemo(() => voBatches(lines, edits), [lines, edits]);
  const problems = useMemo(() => lines.map((l) => editProblem(effectiveEdit(l, edits[l.id]))).filter((x): x is string => !!x), [lines, edits]);
  const pendingByPo = useMemo(() => {
    const m = new Map<string, PendingPoChange[]>();
    for (const c of q.data?.pendingPoChanges ?? []) m.set(c.poId, [...(m.get(c.poId) ?? []), c]);
    return m;
  }, [q.data]);

  if (q.error) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The sales order lines could not be loaded: {q.error}</p>;
  if (!q.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading PO...</p>;
  const d = q.data;
  const editable = p.canWrite;
  const toggle = (key: string): void => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allKeys = tree.flatMap((c) => [c.key, ...c.subs.map((s) => s.key)]);
  const setEdit = (id: string, patch: Partial<LineEdit>): void => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const nextVo = (vo.data?.vos.length ?? 0) + 1;
  const voLabel = (i: number): string => `VO-${String(nextVo + i).padStart(2, "0")}`;
  const buy = lines.filter((l) => l.goesTo === "po");
  const needPo = buy.filter((l) => !l.plan.noPo && !l.pos.some((x) => x.poStatus !== "CANCELLED"));
  const canConfirmPo = can("scm.po_amendment.approve");

  const save = async (): Promise<void> => {
    setSaving(true);
    const posted: PostedVo[] = [];
    for (const b of batches) posted.push(await postVo(b, `beta-lines-${p.projectId}-${b.docNo}-${Date.now()}`));
    setSaving(false);
    setConfirming(false);
    const refused: Record<string, string> = {};
    for (const r of posted) if (r.refusal) refused[r.docNo] = r.refusal;
    setRefusals(refused);
    // Keep the edits of an order that refused, so they can be fixed; drop the applied ones.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => refused[lines.find((l) => l.id === id)?.soDocNo ?? ""])));
    setResult(posted);
    q.reload();
    vo.reload();
  };

  const saveDate = async (l: ManagedLine, which: DateField, value: string): Promise<void> => {
    const dates = lineDates(l);
    const v = value || null;
    setBusyKey(`${l.id}:${which}`);
    try {
      if (which === "poDate") {
        if (!dates.fromPo) return;
        if (!v) throw new Error("A PO always has a PO date.");
        await linesApi.setPoDate(dates.fromPo.poId, v);
      } else if (which === "deliverOn" && dates.fromPo) {
        await linesApi.setPoLineDelivery(dates.fromPo.poId, dates.fromPo.poLineId, v);
      } else {
        await linesApi.savePlan(p.projectId, l.id, { [which]: v });
      }
      q.reload();
    } catch (e) {
      p.onError(refusalText(e));
    } finally {
      setBusyKey(null);
    }
  };

  const setNoPo = async (l: ManagedLine, noPo: boolean): Promise<void> => {
    setBusyKey(`${l.id}:noPo`);
    try { await linesApi.savePlan(p.projectId, l.id, { noPo }); q.reload(); } catch (e) { p.onError(refusalText(e)); } finally { setBusyKey(null); }
  };

  const confirmPo = async (c: PendingPoChange): Promise<void> => {
    setBusyKey(`po:${c.id}`);
    try { await linesApi.confirmPoChange(c.id); p.onDone(`${c.poNumber} change approved; the PO now follows ${c.voLabel ?? "the VO"}.`); q.reload(); }
    catch (e) { p.onError(refusalText(e)); }
    finally { setBusyKey(null); }
  };

  const exportCsv = (): void => {
    const blob = new Blob(["﻿", linesCsv(lines, d.finance)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `project-${p.projectId}-lines.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cell = (l: ManagedLine): RowCtx => ({
    l, edit: edits[l.id], editable: editable && l.voLocked, finance: d.finance, today: p.today, plansReady: d.plansReady, busyKey,
    refusal: edits[l.id] ? refusals[l.soDocNo] ?? null : null, pending: l.pos.flatMap((x) => pendingByPo.get(x.poId) ?? []),
    setEdit: (patch) => setEdit(l.id, patch), pick: () => setPicking(l), saveDate: (w, v) => void saveDate(l, w, v), setNoPo: (v) => void setNoPo(l, v),
  });

  return (
    <>
      <WsNarrowStyle />
      <WsPageHead
        title="PO"
        sub="Every line of the sales order, after VOs. Change a yellow field, then Save & post to VO: the order changes at once and the VO keeps the record."
        right={(
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tree.length > 0 && <button type="button" style={btnStyle("outline", "sm")} onClick={() => setClosed(closed.size ? new Set() : new Set(allKeys))}>{closed.size ? "Open all" : "Close all"}</button>}
            {lines.length > 0 && <button type="button" style={btnStyle("outline", "sm")} onClick={exportCsv}><Download size={14} aria-hidden="true" />Export</button>}
            {needPo.length > 0 && d.sos.map((s) => (
              <Link key={s.docNo} to={s.renovation ? `/scm/renovation/contracts/${encodeURIComponent(s.docNo)}` : "/scm/purchase-orders/from-so"} style={btnStyle("teal", "sm")}>
                <FilePlus2 size={14} aria-hidden="true" />Create PO{d.sos.length > 1 ? ` (${s.docNo})` : ""}
              </Link>
            ))}
          </span>
        )}
      />
      {lines.length > 0 && (
        <div role="group" aria-label="Group the lines" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <WsFilterPill on={view === "category"} onClick={() => setView("category")}>By category</WsFilterPill>
          <WsFilterPill on={view === "area"} onClick={() => setView("area")}>By area</WsFilterPill>
        </div>
      )}
      <WsStats>
        <WsStat label="Lines" value={lines.length} meta={`${buy.length} we buy`} />
        <WsStat label="Need a PO" value={needPo.length} meta={needPo.length ? "No PO yet" : "All ordered"} tone={needPo.length ? WS.amber : WS.green} />
        <WsStat label="Goods received" value={`${buy.filter((l) => l.gr === "yes").length} of ${buy.length}`} meta="Lines fully received" />
        <WsStat label="Delivered (DO)" value={`${lines.filter((l) => l.do === "yes").length} of ${lines.length}`} meta="Lines fully delivered" />
      </WsStats>

      {d.pendingPoChanges.length > 0 && (
        <div role="status" style={{ border: `1px solid #F0C98A`, background: "#FDF1E2", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {d.pendingPoChanges.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: WS.amber, fontSize: 14 }}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span style={{ flex: "1 1 260px" }}>
                <b>{c.poNumber}: PO change waiting for approval.</b> {c.voLabel ?? "A VO"} changed a line on this PO; the PO stays as it was until the change is approved.
              </span>
              <Link to={`/scm/po-amendments/${c.id}`} style={btnStyle("outline", "sm")}>Open {c.amendmentNo}</Link>
              {canConfirmPo ? (
                <button type="button" style={btnStyle("amber", "sm")} disabled={busyKey === `po:${c.id}`} onClick={() => void confirmPo(c)}>
                  {busyKey === `po:${c.id}` ? "Approving..." : "Approve PO change"}
                </button>
              ) : <WsBadge tone={TONE_WAIT} size={12}>Waiting for PO approval</WsBadge>}
            </div>
          ))}
        </div>
      )}

      {result && <SaveResult posted={result} onClose={() => setResult(null)} />}
      {d.sos.some((s) => !s.voLocked) && (
        <p style={{ margin: 0, fontSize: 13, color: WS.text2 }}>A draft order's lines are changed on the order itself; they show here read only until it is confirmed.</p>
      )}

      {tree.length === 0 ? <WsEmpty>No sales order lines for this project yet. Link a sales order to see its lines here.</WsEmpty> : (
        <WsTable minWidth={980} label="Sales order lines by category">
          <thead>
            <tr>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Variants</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
              {d.finance && <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>}
              <th style={thStyle}>Processing date</th>
              <th style={thStyle}>Delivery date</th>
              <th style={thStyle}>PO</th>
              <th style={thStyle}>GR</th>
              <th style={thStyle}>DO</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((c, ci) => {
              const open = !closed.has(c.key);
              const band = BANDS[ci % BANDS.length];
              return [
                <Band key={c.key} band={band} level="cat" label={c.label} hint={catHint(c.subs.flatMap((s) => s.items), d.finance)} open={open} onToggle={() => toggle(c.key)} cols={d.finance ? COLS : COLS - 1} />,
                ...(open ? c.subs.flatMap((s) => {
                  if (!s.label) return s.items.map((l) => <LineRow key={l.id} {...cell(l)} />);
                  const subOpen = !closed.has(s.key);
                  return [
                    <Band key={s.key} band={band} level="sub" label={s.label} hint={`${s.items.length} line${s.items.length === 1 ? "" : "s"}`} open={subOpen} onToggle={() => toggle(s.key)} cols={d.finance ? COLS : COLS - 1} />,
                    ...(subOpen ? s.items.map((l) => <LineRow key={l.id} {...cell(l)} />) : []),
                  ];
                }) : []),
              ];
            })}
          </tbody>
        </WsTable>
      )}
      {tree.length > 0 && (
        <WsNarrow label="Sales order lines by category">
          {tree.map((c, ci) => {
            const band = BANDS[ci % BANDS.length];
            const open = !closed.has(c.key);
            return (
              <li key={c.key}>
                <button type="button" aria-expanded={open} onClick={() => toggle(c.key)}
                  style={{ width: "100%", border: 0, borderLeft: `4px solid ${band[0]}`, borderBottom: `1px solid ${BETA.line}`, background: band[1], color: band[2], padding: "8px 12px", font: "inherit", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", gap: 6, alignItems: "center", textAlign: "left" }}>
                  {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                  <span style={{ flex: 1 }}>{c.label} ({c.count})</span>
                </button>
                {open && (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {c.subs.flatMap((s) => s.items).map((l) => <NarrowLine key={l.id} {...cell(l)} />)}
                  </ul>
                )}
              </li>
            );
          })}
        </WsNarrow>
      )}

      {batches.length > 0 && (
        <div style={{ position: "sticky", bottom: 0, zIndex: 5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", padding: "10px 12px", background: BETA.surface, border: `1px solid ${EDIT_LINE}`, borderRadius: 10, boxShadow: "0 -2px 10px rgba(0,0,0,.06)" }}>
          <span style={{ flex: "1 1 200px", fontSize: 14 }}>
            {batches.reduce((n, b) => n + b.lines.length, 0)} line{batches.reduce((n, b) => n + b.lines.length, 0) === 1 ? "" : "s"} changed
            {problems.length > 0 && <span style={{ color: WS.red }}> · {problems[0]}</span>}
          </span>
          <button type="button" style={btnStyle("outline", "md")} onClick={() => { setEdits({}); setRefusals({}); }}>Discard</button>
          <button type="button" style={btnStyle("teal", "md")} disabled={problems.length > 0} onClick={() => setConfirming(true)}>
            Save & post to VO ({batches.map((_, i) => voLabel(i)).join(", ")})
          </button>
        </div>
      )}

      {confirming && (
        <WsDialog
          title="Save & post to VO"
          sub="These changes apply to the sales order now. No approval is needed; the VO keeps the record."
          onClose={() => { if (!saving) setConfirming(false); }}
          wide
          footer={(
            <>
              <button type="button" style={btnStyle("outline")} disabled={saving} onClick={() => setConfirming(false)}>Back</button>
              <button type="button" style={btnStyle("teal")} disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save & post to VO"}</button>
            </>
          )}
        >
          {batches.map((b, i) => (
            <div key={b.docNo} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>{voLabel(i)} on {b.docNo}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                {lines.filter((l) => l.soDocNo === b.docNo).map((l) => {
                  const e = effectiveEdit(l, edits[l.id]);
                  if (!e) return null;
                  const after = amountAfter(l, e);
                  return (
                    <li key={l.id}>
                      <b>{l.itemCode}</b> {l.description}: {editWords(l, e).join("; ")}
                      {d.finance && after !== null && l.amountSen !== null && after !== l.amountSen && (
                        <span style={{ color: WS.text2 }}> · amount {money(l.amountSen)} {"->"} {money(after)}</span>
                      )}
                      {l.pos.some((x) => x.poStatus !== "CANCELLED") && (e.qty !== undefined || e.itemCode || e.colour !== undefined) && (
                        <div style={{ ...metaStyle, color: WS.amber }}>On a PO: the PO itself changes only after the PO change is approved.</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </WsDialog>
      )}
      {picking && (
        <SkuPicker
          current={picking.itemCode}
          onClose={() => setPicking(null)}
          onPick={(code, name, priceSen) => { setEdit(picking.id, { itemCode: code, pickedName: name, pickedPriceSen: priceSen }); setPicking(null); }}
        />
      )}
    </>
  );
}

function catHint(items: readonly ManagedLine[], finance: boolean): string {
  const onPo = items.filter((l) => l.pos.some((x) => x.poStatus !== "CANCELLED")).length;
  const total = items.reduce((s, l) => s + (l.amountSen ?? 0), 0);
  return [`${items.length} line${items.length === 1 ? "" : "s"}`, `${onPo} on PO`, finance ? money(total) : null].filter(Boolean).join(" · ");
}

function Band({ band, level, label, hint, open, onToggle, cols }: { band: readonly [string, string, string]; level: "cat" | "sub"; label: string; hint: string; open: boolean; onToggle: () => void; cols: number }): ReactElement {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <tr>
      <td colSpan={cols} style={{ padding: 0, background: level === "cat" ? band[1] : WS.tealSoft, borderBottom: `1px solid ${BETA.line}` }}>
        <button type="button" aria-expanded={open} onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: level === "cat" ? 42 : 36, padding: `0 12px 0 ${level === "cat" ? 8 : 28}px`, border: 0,
            borderLeft: `4px solid ${level === "cat" ? band[0] : `${band[0]}66`}`, background: "transparent", color: level === "cat" ? band[2] : WS.text2, font: "inherit",
            fontSize: level === "cat" ? 15 : 13, fontWeight: level === "cat" ? 700 : 600, cursor: "pointer", textAlign: "left",
          }}>
          <Icon size={16} aria-hidden="true" />
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: WS.text2 }}>{hint}</span>
        </button>
      </td>
    </tr>
  );
}

interface RowCtx {
  l: ManagedLine;
  edit: LineEdit | undefined;
  editable: boolean;
  finance: boolean;
  today: string;
  plansReady: boolean;
  busyKey: string | null;
  refusal: string | null;
  pending: PendingPoChange[];
  setEdit: (patch: Partial<LineEdit>) => void;
  pick: () => void;
  saveDate: (which: DateField, value: string) => void;
  setNoPo: (v: boolean) => void;
}

function changed(r: RowCtx): LineEdit | null {
  return effectiveEdit(r.l, r.edit);
}

function SkuCell(r: RowCtx): ReactElement {
  const e = changed(r);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      {r.editable ? (
        <button type="button" onClick={r.pick} aria-label={`Change SKU ${r.l.itemCode}`}
          style={{ ...editInput, width: "auto", maxWidth: 150, minWidth: 100, display: "inline-flex", textAlign: "left", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "ui-monospace, monospace" }}>
          {e?.itemCode ?? r.l.itemCode}<Search size={12} aria-hidden="true" />
        </button>
      ) : <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{r.l.itemCode}</span>}
      {e?.itemCode && <span style={{ ...metaStyle, textDecoration: "line-through" }}>{r.l.itemCode}</span>}
    </div>
  );
}

function DescCell(r: RowCtx): ReactElement {
  const e = changed(r);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 190 }}>
      <span style={{ fontWeight: 600 }}>{e?.pickedName ?? r.l.description}</span>
      <span style={metaStyle}>{[r.l.supplierName, r.l.area, r.l.uom].filter(Boolean).join(" · ")}</span>
      {r.l.goesTo !== "po" && <span><WsBadge tone={TONE_QUIET} size={11}>{r.l.goesTo === "client" ? "Client buys (Client PO)" : "Our works"}</WsBadge></span>}
      <LinePhotoThumbs photos={linePhotoSet(r.l)} label={r.l.description || r.l.itemCode} />
      {r.editable ? (
        <input aria-label={`Remark for ${r.l.itemCode}`} placeholder="Remark" style={editInput} value={r.edit?.remark ?? r.l.remark ?? ""} onChange={(ev) => r.setEdit({ remark: ev.target.value })} />
      ) : r.l.remark && <span style={metaStyle}>{r.l.remark}</span>}
      {r.refusal && <span role="alert" style={{ fontSize: 12, color: WS.red }}>Not saved: {r.refusal}</span>}
      {r.pending.map((c) => (
        <Link key={c.id} to={`/scm/po-amendments/${c.id}`} style={{ fontSize: 12, color: WS.amber, fontWeight: 600 }}>
          {c.poNumber}: change from {c.voLabel ?? "a VO"} waiting for PO approval
        </Link>
      ))}
    </div>
  );
}

function VariantCell(r: RowCtx): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 130 }}>
      {r.l.variantText && <span style={{ fontSize: 13 }}>{r.l.variantText}</span>}
      {r.editable && colourEditable(r.l) ? (
        <input aria-label={`Colour for ${r.l.itemCode}`} placeholder="Colour / code" style={editInput} value={r.edit?.colour ?? colourOf(r.l)} onChange={(ev) => r.setEdit({ colour: ev.target.value })} />
      ) : !r.l.variantText && <span style={metaStyle}>-</span>}
    </div>
  );
}

function QtyCell(r: RowCtx): ReactElement {
  if (!r.editable) return <span>{r.l.qty}</span>;
  return (
    <input aria-label={`Qty for ${r.l.itemCode}`} type="number" min={1} step={1} inputMode="numeric" style={{ ...editInput, width: 72, textAlign: "right" }}
      value={r.edit?.qty ?? r.l.qty} onChange={(ev) => r.setEdit({ qty: ev.target.value === "" ? Number.NaN : Number(ev.target.value) })} />
  );
}

function AmountCell(r: RowCtx): ReactElement {
  const e = changed(r);
  const after = amountAfter(r.l, e);
  if (r.l.amountSen === null) return <span>-</span>;
  const moved = after !== null && after !== r.l.amountSen;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={{ fontWeight: moved ? 700 : 400 }}>{money(after ?? r.l.amountSen)}</span>
      {moved && <span style={{ ...metaStyle, textDecoration: "line-through" }}>{money(r.l.amountSen)}</span>}
    </span>
  );
}

function DateInput({ r, which, value, label, late }: { r: RowCtx; which: DateField; value: string | null; label: string; late: boolean }): ReactElement {
  return (
    <input type="date" aria-label={`${label} for ${r.l.itemCode}`} disabled={r.busyKey === `${r.l.id}:${which}`}
      style={{ ...dateInput, ...(late ? { borderColor: WS.red, color: WS.red } : {}) }}
      defaultValue={value ?? ""} key={`${value ?? ""}`}
      onBlur={(ev) => { if ((ev.target.value || null) !== (value ?? null)) r.saveDate(which, ev.target.value); }} />
  );
}

/** When to place the order: the line's own date, before and after a PO exists. */
function ProcessingCell({ r }: { r: RowCtx }): ReactElement {
  const d = lineDates(r.l);
  const late = lineLate(r.l, r.today) === "order";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {r.editable && r.plansReady ? <DateInput r={r} which="orderOn" value={d.orderOn} label="Processing date" late={late} />
        : <span style={late ? { color: WS.red, fontWeight: 600 } : undefined}>{d.orderOn ? dayMonthYear(d.orderOn) : "-"}</span>}
      {late && <WsBadge tone={TONE_ALERT} size={11}>Order late</WsBadge>}
    </div>
  );
}

/** When to deliver: the PO line's delivery date once a PO holds the line (changed on the PO), else the line's own. */
function DeliveryCell({ r }: { r: RowCtx }): ReactElement {
  const d = lineDates(r.l);
  const late = lineLate(r.l, r.today) === "deliver";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {r.editable && (d.fromPo || r.plansReady) ? <DateInput r={r} which="deliverOn" value={d.deliverOn} label="Delivery date" late={late} />
        : <span style={late ? { color: WS.red, fontWeight: 600 } : undefined}>{d.deliverOn ? dayMonthYear(d.deliverOn) : "-"}</span>}
      {late && <WsBadge tone={TONE_ALERT} size={11}>Delivery late</WsBadge>}
      {d.fromPo && <span style={metaStyle}>On the PO</span>}
    </div>
  );
}

/** The PO doc no and its PO date once a PO holds the line, else "-" (and, for a line we buy, whether it needs one). */
function PoCell({ r }: { r: RowCtx }): ReactElement {
  const po = livePo(r.l);
  if (po) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Link to={`/scm/purchase-orders/${po.poId}`} style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{po.poNumber}</Link>
        {r.editable ? <DateInput r={r} which="poDate" value={po.poDate} label={`PO date of ${po.poNumber}`} late={false} />
          : <span style={metaStyle}>{dayMonthYear(po.poDate)}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span>-</span>
      {r.l.goesTo === "po" && (r.editable && r.plansReady ? (
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: WS.text2, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={r.l.plan.noPo} disabled={r.busyKey === `${r.l.id}:noPo`} onChange={(ev) => r.setNoPo(ev.target.checked)} />No PO needed
        </label>
      ) : r.l.plan.noPo ? <span style={metaStyle}>No PO needed</span> : null)}
    </div>
  );
}

function linePhotoSet(l: ManagedLine): LinePhotoSet {
  return {
    so: l.photoKeys.length ? { docNo: l.soDocNo, itemId: l.id, keys: l.photoKeys } : null,
    po: l.pos.filter((x) => x.photoKeys.length > 0).map((x) => ({ poId: x.poId, poLineId: x.poLineId, poNumber: x.poNumber, keys: x.photoKeys })),
    sku: l.skuPhotos,
  };
}

function grMark(l: ManagedLine): ReactElement {
  if (l.goesTo !== "po" && l.pos.length === 0) return <span style={metaStyle}>-</span>;
  return <WsMark state={l.gr} />;
}

function LineRow(r: RowCtx): ReactElement {
  const dim = r.l.goesTo === "client";
  const touched = changed(r) !== null;
  return (
    <tr style={{ opacity: dim ? 0.75 : 1, background: touched ? "#FFFDF0" : undefined }}>
      <td style={{ ...tdStyle, paddingLeft: 24 }}><SkuCell {...r} /></td>
      <td style={tdStyle}><DescCell {...r} /></td>
      <td style={tdStyle}><VariantCell {...r} /></td>
      <td style={numStyle}><QtyCell {...r} /></td>
      {r.finance && <td style={numStyle}><AmountCell {...r} /></td>}
      <td style={tdStyle}><ProcessingCell r={r} /></td>
      <td style={tdStyle}><DeliveryCell r={r} /></td>
      <td style={tdStyle}><PoCell r={r} /></td>
      <td style={tdStyle}>{grMark(r.l)}</td>
      <td style={tdStyle}><WsMark state={r.l.do} /></td>
    </tr>
  );
}

function NarrowLine(r: RowCtx): ReactElement {
  const touched = changed(r) !== null;
  return (
    <li style={{ ...narrowItemStyle, gap: 8, opacity: r.l.goesTo === "client" ? 0.75 : 1, background: touched ? "#FFFDF0" : BETA.surface }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <SkuCell {...r} />
        {r.finance && <AmountCell {...r} />}
      </div>
      <DescCell {...r} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 150px" }}><VariantCell {...r} /></div>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: BETA.muted }}>Qty ({r.l.uom})<QtyCell {...r} /></label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div><div style={metaStyle}>Processing date</div><ProcessingCell r={r} /></div>
        <div><div style={metaStyle}>Delivery date</div><DeliveryCell r={r} /></div>
        <div><div style={metaStyle}>PO</div><PoCell r={r} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", ...metaStyle }}>GR {grMark(r.l)} DO <WsMark state={r.l.do} /></div>
    </li>
  );
}

function SaveResult({ posted, onClose }: { posted: PostedVo[]; onClose: () => void }): ReactElement {
  const ok = posted.every((x) => x.applied);
  return (
    <div role="status" style={{ border: `1px solid ${ok ? "#B7DCC3" : "#E8A5A2"}`, background: ok ? "#E5F3EA" : "#FDF1F0", borderRadius: 10, padding: "10px 12px", fontSize: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {posted.map((x) => (
          <div key={x.docNo}>
            {x.applied
              ? <span style={{ color: WS.green }}><b>Saved.</b> {x.docNo} changed{x.amendmentNo ? ` (${x.amendmentNo})` : ""}; the VO is in the VO tab.</span>
              : <span style={{ color: WS.red }}><b>{x.docNo} not changed.</b> {x.refusal}</span>}
            {x.followUps.length > 0 && (
              <div style={{ color: WS.amber }}>
                PO change waiting for approval (the PO has not changed yet): {x.followUps.map((f) => `${f.poNumber} (${f.amendmentNo})`).join(", ")}.
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" style={btnStyle("outline", "sm")} onClick={onClose}>OK</button>
    </div>
  );
}

function SkuPicker({ current, onPick, onClose }: { current: string; onPick: (code: string, name: string, priceSen: number) => void; onClose: () => void }): ReactElement {
  const [search, setSearch] = useState("");
  const q = useMfgProducts({ search: search.trim(), enabled: search.trim().length >= 2 });
  const rows = (q.data ?? []).filter((x) => x.code !== current && String((x as { status?: string }).status ?? "ACTIVE").toUpperCase() === "ACTIVE").slice(0, 40);
  return (
    <WsDialog title="Swap SKU" sub={`Replaces ${current} on this line. The amount uses the new SKU's price.`} onClose={onClose} wide>
      <input autoFocus aria-label="Search the catalog" placeholder="Search by SKU or name (2 letters or more)" style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${BETA.line}`, borderRadius: 8 }}>
        {search.trim().length < 2 ? <p style={{ margin: 0, padding: 12, ...metaStyle }}>Type to search the catalog.</p>
          : q.isLoading ? <p style={{ margin: 0, padding: 12, ...metaStyle }}>Searching...</p>
          : rows.length === 0 ? <p style={{ margin: 0, padding: 12, ...metaStyle }}>No active SKU matches.</p>
          : rows.map((x) => (
            <button key={x.id} type="button" onClick={() => onPick(x.code, x.name, x.sell_price_sen ?? 0)}
              style={{ display: "flex", width: "100%", gap: 8, justifyContent: "space-between", padding: "10px 12px", border: 0, borderBottom: `1px solid ${WS.rowLine}`, background: BETA.surface, font: "inherit", cursor: "pointer", textAlign: "left" }}>
              <span><span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{x.code}</span><br /><span style={{ fontSize: 14 }}>{x.name}</span></span>
              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(x.sell_price_sen ?? 0)}</span>
            </button>
          ))}
      </div>
      {q.error && <p role="alert" style={{ margin: 0, color: WS.red, fontSize: 13 }}>The catalog could not be searched.</p>}
    </WsDialog>
  );
}
