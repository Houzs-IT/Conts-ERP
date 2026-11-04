/* Beta workspace > PO (owner, 24 Oct 2026): the project's line manager. Every current line of its sales order(s),
   after VOs, by category: SKU, description, variants, qty, amount, when to order, when to deliver, and whether the goods
   were received (GR) and delivered (DO).

   The tab reads as plain text until Edit is pressed (owner, 24 Oct 2026). In edit mode the pale yellow fields change
   the line, and "Save & post to VO" applies every change to the sales order at once and keeps it as one VO per order
   (no approval: renovationBetaLines.ts postVo). The dates are not VOs and save as they are set: on a line a PO holds
   they change the PO itself; before that they are the plan. A category band sets the date of every line in it through
   the same per-line paths, and the lines show the new date at once (owner, 3 Nov 2026: a band date seemed not to reach
   its lines); a line whose date cannot move from here says why. The lines sit straight under their category: no
   sub-category bands (owner, 3 Nov 2026). In Edit mode a line still waiting for its PO picks its supplier as in MRP
   (owner, 4 Nov 2026): the SKU's bound suppliers, main starred, then every other one, which the pick binds. MRP and
   Create PO start from that pick. A document's own fields are changed in its editor, not here: the PO number opens the
   PO and the GR and DO links their tabs (owner, 4 Nov 2026). A PO a VO changed is flagged until purchasing confirms the
   PO change. */

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ProductionOrderChips } from "../scm-v2/ProductionOrderChips";
import { AlertTriangle, Calculator, Camera, ChevronDown, ChevronRight, Download, FilePlus2, Pencil, Search } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { buildQueryKey, useQuery } from "../../hooks/useQuery";
import { useQueryClient } from "@tanstack/react-query";
import { money } from "../projects/renovation/renovationModel";
import { WS, WsBadge, WsDialog, WsEmpty, WsFilterPill, WsPageHead, TONE_QUIET, TONE_WAIT, btnStyle, inputStyle } from "./BetaWsUi";
import { WsStat, WsStats, metaStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonth, dayMonthYear } from "./renovationBetaModel";
import { lineDocs, type LineDoc } from "./renovationBetaDocsModel";
import { DocCell, useOpenDoc, type DocTab } from "./BetaLineDocs";
import { betaSiteApi } from "./renovationBetaSiteApi";
import { betaMediaApi } from "./renovationBetaMediaApi";
import { PhotoUploadDialog, type UploadTarget } from "./BetaPhotoUpload";
import { BetaSkuPicker } from "./BetaSkuPicker";
import { BetaQuantityHelper } from "./BetaQuantityHelper";
import { BETA, TONES } from "./renovationBetaTheme";
import { voPoApi } from "./renovationBetaVoPo";
import { LinePhotoThumbs, photoCount, type LinePhotoSet } from "./BetaLinePhotos";
import {
  amountAfter, byAreaBlocks, byCategory, livePo, specLocked, SPEC_LOCKED_NOTE, dateFixedReason, dateSettable, editProblem, editWords, effectiveEdit, groupDate, groupDateTargets, groupRange, lineDates, lineLate,
  linesApi, linesCsv, picksSupplier, postVo, refusalText, supplierOf, withDate,
  contractLineEdits, postContractLines, variantsAfter, voBatches,
  type LineEdit, type LinesAnswer, type VoBatch, type ManagedLine, type PendingPoChange, type PostedVo,
} from "./renovationBetaLines";
import { buildVariantSummary } from "../../vendor/shared/variant-summary";
import { RenovationVariantPicker, hasVariantPickers } from "../../vendor/scm/components/renovationVariantPicker";
import { BetaLoading } from "./BetaLoading";
import { SoStockPill } from "../../components/SoSourceChips";
import type { SoLineCoverage } from "../../vendor/scm/lib/sales-order-queries";
import { useProjectLineStock } from "./renovationBetaStock";
import { bandParts, columnWidth, moveColumn, usePoColumns, type PoColumn } from "./renovationPoColumns";

/** One colour per category band, in the mockup's spirit: [bar, band background, text]. */
const BAND_BARS = ["#1A6B66", "#B4540A", "#1F4E8C", "#7A3E9D", "#2E7D32", "#A12622"] as const;
/* The band's tint and text are mixed from its bar colour, so the same six read on a light and a dark page. */
const BANDS: ReadonlyArray<readonly [string, string, string]> = BAND_BARS.map((bar) => [
  bar, `color-mix(in srgb, ${bar} 14%, transparent)`, `color-mix(in srgb, ${bar} 60%, ${BETA.ink})`,
] as const);

const EDIT_BG = TONES.amber.soft;
const EDIT_LINE = TONES.amber.line;
const editInput: CSSProperties = { ...inputStyle, minHeight: 30, height: 30, fontSize: 12.5, background: EDIT_BG, borderColor: EDIT_LINE, padding: "0 6px" };
/* Below this width of the tab the table becomes stacked row cards: every column fits from here up (1280-1600px
   screens, 80% zoom included), and nothing is ever hidden or scrolled sideways. */
const TABLE_MIN = 1120;
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
const cellStyle: CSSProperties = { padding: "6px 6px", fontSize: 13, borderBottom: `1px solid ${WS.rowLine}`, verticalAlign: "middle", overflow: "hidden" };
const headStyle: CSSProperties = { ...thStyle, padding: "8px 6px", fontSize: 11.5, ...ellipsis };

const COLUMN_HEAD: Record<PoColumn, { label: string; title?: string; right?: boolean }> = {
  sku: { label: "SKU" }, desc: { label: "Description" }, variants: { label: "Variants" }, qty: { label: "Qty", right: true }, amount: { label: "Amount", right: true },
  orderOn: { label: "Processing", title: "Processing date: when to place the order" }, deliverOn: { label: "Delivery", title: "Delivery date" },
  supplier: { label: "Supplier", title: "Who the line is bought from" }, stock: { label: "Stock", title: "Same verdict as the sales order page" }, po: { label: "PO" }, gr: { label: "GR" }, do: { label: "DO" },
};

/** The tab's own width, so the layout follows the space it has (inside Property OS it is not the window's). */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(el.clientWidth);
    ro.current = new ResizeObserver((es) => { const e = es[0]; if (e) setW(e.contentRect.width); });
    ro.current.observe(el);
  }, []);
  return [ref, w];
}

type PlanDate = "orderOn" | "deliverOn";

export function BetaPoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "lines", p.projectId], () => linesApi.lines(p.projectId), [p.projectId]);
  const queryClient = useQueryClient();
  /* A saved date or supplier shows on its lines at once, before the reload answers: under load the reload can be slow,
     and the band then looked as if it had not reached its lines. */
  const patchLines = (ids: ReadonlySet<string>, fn: (l: ManagedLine) => ManagedLine): void => {
    queryClient.setQueryData<LinesAnswer>(buildQueryKey(["renovation-beta", "lines", p.projectId], [p.projectId]),
      (old) => (old ? { ...old, lines: old.lines.map((l) => (ids.has(l.id) ? fn(l) : l)) } : old));
  };
  const vo = useQuery(["renovation-beta", "vo", p.projectId], () => voPoApi.vo(p.projectId), [p.projectId]);
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const openDoc = useOpenDoc();
  const photos = useQuery(["renovation-beta", "photos", p.projectId], () => betaMediaApi.photos(p.projectId), [p.projectId]);
  const [uploading, setUploading] = useState<UploadTarget | null>(null);
  const { order, moved, setOrder } = usePoColumns();
  const [dragging, setDragging] = useState<PoColumn | null>(null);
  const [dropOn, setDropOn] = useState<PoColumn | null>(null);
  const { can } = useAuth();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [picking, setPicking] = useState<ManagedLine | null>(null);
  /* The variants dialog of one line, at the tab's level like the SKU picker: inside the table row a cell clips it. */
  const [varying, setVarying] = useState<ManagedLine | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PostedVo[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [helping, setHelping] = useState(false);
  const [wrapRef, width] = useWidth();

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

  const stockByLine = useProjectLineStock(q.data?.sos.map((x) => x.docNo) ?? []);

  if (q.error && !q.data) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The sales order lines could not be loaded: {q.error}</p>;
  if (!q.data) return <BetaLoading label="Loading PO" />;
  const d = q.data;
  const editable = p.canWrite && editing;
  const columns = d.finance ? order : order.filter((c) => c !== "amount");
  const toggle = (key: string): void => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allKeys = tree.map((c) => c.key);
  const setEdit = (id: string, patch: Partial<LineEdit>): void => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const nextVo = (vo.data?.vos.length ?? 0) + 1;
  const voLabel = (i: number): string => `VO-${String(nextVo + i).padStart(2, "0")}`;
  const buy = lines.filter((l) => l.goesTo === "po");
  const needPo = buy.filter((l) => !l.plan.noPo && !l.pos.some((x) => x.poStatus !== "CANCELLED"));
  const canConfirmPo = can("scm.po_amendment.approve");

  /* Renovation contracts: a SKU or qty change raises one contract VO per contract (approved for you); options and
     remarks save on the line with no VO. */
  const contractSo = new Set(d.sos.filter((s) => s.renovation).map((s) => s.docNo));
  const raisesVo = (b: VoBatch): boolean => !contractSo.has(b.docNo) || contractLineEdits(b).length > 0;
  const voBatchesShown = batches.filter((b) => !contractSo.has(b.docNo));
  const batchTitle = (b: VoBatch): string => {
    if (!contractSo.has(b.docNo)) return `${voLabel(voBatchesShown.indexOf(b))} on ${b.docNo}`;
    return raisesVo(b) ? `New contract VO on ${b.docNo}` : `${b.docNo}: saved on the lines, no VO (nothing the customer pays for changes)`;
  };
  const anyVo = batches.some(raisesVo);
  const saveLabel = anyVo ? "Save & post to VO" : "Save";
  const save = async (): Promise<void> => {
    setSaving(true);
    const posted: PostedVo[] = [];
    for (const b of batches) {
      posted.push(contractSo.has(b.docNo) ? await postContractLines(b) : await postVo(b, `beta-lines-${p.projectId}-${b.docNo}-${Date.now()}`));
    }
    setSaving(false);
    setConfirming(false);
    const refused: Record<string, string> = {};
    for (const r of posted) if (r.refusal) refused[r.docNo] = r.refusal;
    setRefusals(refused);
    // Keep the edits of an order that refused, so they can be fixed; drop the applied ones.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => refused[lines.find((l) => l.id === id)?.soDocNo ?? ""])));
    if (Object.keys(refused).length === 0) setEditing(false);
    setResult(posted);
    q.reload();
    vo.reload();
  };

  const saveDate = async (l: ManagedLine, which: PlanDate, value: string): Promise<void> => {
    const dates = lineDates(l);
    const v = value || null;
    setBusyKey(`${l.id}:${which}`);
    try {
      if (which === "deliverOn" && dates.fromPo) {
        await linesApi.setPoLineDelivery(dates.fromPo.poId, dates.fromPo.poLineId, v);
        patchLines(new Set([l.id]), (x) => withDate(x, which, v));
      } else {
        await linesApi.savePlan(p.projectId, l.id, { [which]: v });
        patchLines(new Set([l.id]), (x) => withDate(x, which, v));
      }
      q.reload();
    } catch (e) {
      p.onError(refusalText(e));
    } finally {
      setBusyKey(null);
    }
  };

  /** One date for every line of a band, through each line's own save path; a refusal on one line does not stop the rest. */
  const saveGroupDate = async (key: string, label: string, group: readonly ManagedLine[], which: PlanDate, value: string): Promise<void> => {
    const v = value || null;
    const targets = groupDateTargets(group, which, v, d.plansReady);
    // Lines whose date cannot move from here, and differ from the new one: named in the result with the reason.
    const fixed = group.filter((l) => !dateSettable(l, which, d.plansReady) && (lineDates(l)[which] ?? null) !== v);
    const what = which === "orderOn" ? "Processing date" : "Delivery date";
    const fixedText = fixed.length ? ` Not changed here: ${fixed.map((l) => `${l.itemCode} (${dateFixedReason(l, which, d.plansReady)})`).join("; ")}.` : "";
    if (targets.length === 0) {
      if (fixed.length) p.onError(`${what} of ${label} not changed.${fixedText}`);
      return;
    }
    setBusyKey(`group:${key}:${which}`);
    const refusedLines: string[] = [];
    const saved = new Set<string>();
    let firstReason: string | null = null;
    // The lines show the new date at once; a refused line comes back with the reload below.
    patchLines(new Set(targets.map((l) => l.id)), (x) => withDate(x, which, v));
    const onPo = which === "deliverOn" ? targets.filter((l) => lineDates(l).fromPo) : [];
    const planned = targets.filter((l) => !onPo.includes(l));
    if (planned.length) {
      try {
        const r = await linesApi.savePlans(p.projectId, planned.map((l) => l.id), { [which]: v });
        r.saved.forEach((id) => saved.add(id));
        for (const x of r.refused) { refusedLines.push(x.itemCode); firstReason ??= x.reason; }
      } catch (e) {
        refusedLines.push(...planned.map((l) => l.itemCode));
        firstReason ??= refusalText(e);
      }
    }
    const queue = [...onPo];
    const worker = async (): Promise<void> => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        const po = lineDates(l).fromPo!;
        try {
          await linesApi.setPoLineDelivery(po.poId, po.poLineId, v);
          saved.add(l.id);
        } catch (e) {
          refusedLines.push(l.itemCode);
          firstReason ??= refusalText(e);
        }
      }
    };
    // Two at a time: each PO line is its own request, and the database pool is small (3 Nov 2026).
    await Promise.all([worker(), worker()]);
    setBusyKey(null);
    const done = saved.size;
    // onDone refreshes every Beta query, this list included.
    if (refusedLines.length === 0 && fixed.length === 0) p.onDone(`${what} ${v ? dayMonthYear(v) : "cleared"} on ${done} line${done === 1 ? "" : "s"} of ${label}.`);
    else {
      q.reload();
      const refusedText = refusedLines.length ? ` Not set on ${refusedLines.join(", ")}: ${firstReason}` : "";
      p.onError(`${what} ${v ? dayMonthYear(v) : "cleared"} on ${done} of ${group.length} lines of ${label}.${refusedText}${fixedText}`);
    }
  };

  const saveSupplier = async (l: ManagedLine, supplierId: string): Promise<void> => {
    if (!supplierId || supplierId === l.supplierId) return;
    setBusyKey(`${l.id}:supplier`);
    try {
      const r = await linesApi.saveSupplier(p.projectId, l.id, supplierId);
      patchLines(new Set([l.id]), (x) => ({ ...x, supplierId: r.supplierId, supplierName: r.supplierName }));
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

  const changedCount = batches.reduce((n, b) => n + b.lines.length, 0);
  const bandDates = (key: string, label: string, group: readonly ManagedLine[]): BandDates => ({
    lines: group, editable,
    settable: { orderOn: group.some((l) => dateSettable(l, "orderOn", d.plansReady)), deliverOn: group.some((l) => dateSettable(l, "deliverOn", d.plansReady)) },
    busy: { orderOn: busyKey === `group:${key}:orderOn`, deliverOn: busyKey === `group:${key}:deliverOn` },
    label,
    save: (w, v) => void saveGroupDate(key, label, group, w, v),
  });

  const deliveries = site.data?.deliveries ?? [];
  const cell = (l: ManagedLine): RowCtx => ({
    l, edit: edits[l.id], editable: editable && l.voLocked, contract: contractSo.has(l.soDocNo), finance: d.finance, today: p.today, plansReady: d.plansReady, busyKey,
    refusal: edits[l.id] ? refusals[l.soDocNo] ?? null : null, pending: l.pos.flatMap((x) => pendingByPo.get(x.poId) ?? []),
    setEdit: (patch) => setEdit(l.id, patch), pick: () => setPicking(l), pickVariants: () => setVarying(l), saveDate: (w, v) => void saveDate(l, w, v), setNoPo: (v) => void setNoPo(l, v),
    saveSupplier: (id) => void saveSupplier(l, id), suppliers: d.suppliers ?? [], stock: stockByLine.get(l.id),
    grDocs: lineDocs(l.id, deliveries, "goods_received"), doDocs: lineDocs(l.id, deliveries, "delivery_order"), openDoc,
  });

  return (
    <>
      <style>{DATE_CSS}</style>
      {helping && <BetaQuantityHelper onClose={() => setHelping(false)} />}
      <WsPageHead
        title="SO"
        sub={editing
          ? "Editing. Change a yellow field, then Save. A new amount or SKU is recorded as a VO; options and remarks just save. Dates and suppliers save as you set them. A PO's own date is changed in the PO: click its number."
          : "Every line of the sales order, after VOs."}
        right={(
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.canWrite && lines.length > 0 && !editing && (
              <button type="button" style={btnStyle("dark", "sm")} onClick={() => { setEditing(true); setResult(null); }}><Pencil size={14} aria-hidden="true" />Edit</button>
            )}
            {tree.length > 0 && <button type="button" style={btnStyle("outline", "sm")} onClick={() => setClosed(closed.size ? new Set() : new Set(allKeys))}>{closed.size ? "Open all" : "Close all"}</button>}
            {p.canWrite && (photos.data?.docs.pos.length ?? 0) > 0 && (
              <button type="button" style={btnStyle("outline", "sm")} onClick={() => setUploading({ kind: "po", id: photos.data?.docs.pos[0]?.id ?? "" })}><Camera size={14} aria-hidden="true" />Upload photos</button>
            )}
            {lines.length > 0 && <button type="button" style={btnStyle("outline", "sm")} onClick={exportCsv}><Download size={14} aria-hidden="true" />Export</button>}
            <button type="button" style={btnStyle("outline", "sm")} onClick={() => setHelping(true)}><Calculator size={14} aria-hidden="true" />Quantity helper</button>
            {needPo.length > 0 && d.sos.map((s) => (
              <Link key={s.docNo} to={s.renovation ? `/scm/sales-orders/${encodeURIComponent(s.docNo)}#po-split` : "/scm/purchase-orders/from-so"} style={btnStyle("teal", "sm")}>
                <FilePlus2 size={14} aria-hidden="true" />Create PO{d.sos.length > 1 ? ` (${s.docNo})` : ""}
              </Link>
            ))}
          </span>
        )}
      />
      {d.categoryRestricted && <p style={{ margin: 0, fontSize: 13, color: BETA.muted }}>Some categories are hidden for your role.</p>}
      {d.sos.map((s) => <ProductionOrderChips key={s.docNo} soDocNo={s.docNo} label="Production orders" />)}
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
        <div role="status" style={{ border: `1px solid ${TONES.amber.line}`, background: TONES.amber.soft, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
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

      {moved && (width === 0 || width >= TABLE_MIN) && (
        <button type="button" onClick={() => setOrder(null)} style={{ ...btnStyle("outline", "sm"), alignSelf: "flex-end" }}>Reset columns</button>
      )}

      <div ref={wrapRef} style={{ width: "100%", minWidth: 0 }}>
        {tree.length === 0 ? <WsEmpty>{d.categoryRestricted ? "No lines you can see for this project." : "No sales order lines for this project yet. Link a sales order to see its lines here."}</WsEmpty>
          : width === 0 || width >= TABLE_MIN ? (
            <div role="region" aria-label="Sales order lines" style={{ border: `1px solid ${BETA.line}`, borderRadius: 10, overflow: "hidden", background: BETA.surface }}>
              <table onPointerLeave={() => { setDragging(null); setDropOn(null); }} style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
                <colgroup>{columns.map((c) => <col key={c} style={{ width: `${columnWidth(c, d.finance)}%` }} />)}</colgroup>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} title={`${COLUMN_HEAD[c].title ?? COLUMN_HEAD[c].label} (drag to move)`}
                        onPointerDown={(ev) => { ev.preventDefault(); setDragging(c); }}
                        onPointerEnter={() => { if (dragging) setDropOn(c); }}
                        onPointerUp={() => { if (dragging) setOrder(moveColumn(order, dragging, c)); setDragging(null); setDropOn(null); }}
                        style={{ ...headStyle, ...(COLUMN_HEAD[c].right ? { textAlign: "right" as const } : {}), cursor: dragging ? "grabbing" : "grab", userSelect: "none", touchAction: "none", boxShadow: dropOn === c && dragging !== c ? `inset 2px 0 0 ${WS.tealLine}` : undefined, opacity: dragging === c ? 0.5 : 1 }}>
                        {COLUMN_HEAD[c].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="stag">
                  {tree.map((c, ci) => {
                    const open = !closed.has(c.key);
                    const band = BANDS[ci % BANDS.length];
                    const catLines = c.subs.flatMap((s) => s.items);
                    return [
                      <Band key={c.key} band={band} label={c.label} hint={catHint(catLines, d.finance)} open={open} onToggle={() => toggle(c.key)} columns={columns}
                        dates={bandDates(c.key, c.label, catLines)} />,
                      ...(open ? catLines.map((l) => <LineRow key={l.id} {...cell(l)} columns={columns} />) : []),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul aria-label="Sales order lines" style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${BETA.line}`, borderRadius: 10, overflow: "hidden", background: BETA.surface }}>
              {tree.map((c, ci) => {
                const band = BANDS[ci % BANDS.length];
                const open = !closed.has(c.key);
                return (
                  <li key={c.key}>
                    <button type="button" aria-expanded={open} onClick={() => toggle(c.key)}
                      style={{ width: "100%", border: 0, borderLeft: `4px solid ${band[0]}`, borderBottom: `1px solid ${BETA.line}`, background: band[1], color: band[2], padding: "8px 12px", font: "inherit", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", gap: 6, alignItems: "center", textAlign: "left" }}>
                      {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      <span style={{ flex: 1, ...ellipsis }}>{c.label} ({c.count})</span>
                    </button>
                    {open && (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        <li style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: "6px 12px", borderBottom: `1px solid ${WS.rowLine}`, background: band[1] }}>
                          {(["orderOn", "deliverOn"] as const).map((w) => (
                            <span key={w} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                              <span style={metaStyle}>{w === "orderOn" ? "Processing (all lines)" : "Delivery (all lines)"}</span>
                              <GroupDate g={bandDates(c.key, c.label, c.subs.flatMap((s) => s.items))} which={w} />
                            </span>
                          ))}
                        </li>
                        {c.subs.flatMap((s) => s.items).map((l) => <LineCard key={l.id} {...cell(l)} />)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </div>

      {editing && (
        <div style={{ position: "sticky", bottom: 0, zIndex: 5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", padding: "10px 12px", background: BETA.surface, border: `1px solid ${EDIT_LINE}`, borderRadius: 10, boxShadow: "0 -2px 10px rgba(0,0,0,.06)" }}>
          <span style={{ flex: "1 1 200px", fontSize: 14 }}>
            {changedCount > 0 ? `${changedCount} line${changedCount === 1 ? "" : "s"} changed` : "Editing: no line changed yet."}
            {problems.length > 0 && <span style={{ color: WS.red }}> · {problems[0]}</span>}
          </span>
          {changedCount > 0
            ? <button type="button" style={btnStyle("outline", "md")} onClick={() => { setEdits({}); setRefusals({}); setEditing(false); }}>Discard</button>
            : <button type="button" style={btnStyle("outline", "md")} onClick={() => { setRefusals({}); setEditing(false); }}>Done</button>}
          <button type="button" style={btnStyle("teal", "md")} disabled={problems.length > 0 || changedCount === 0} onClick={() => setConfirming(true)}>
            {saveLabel}{voBatchesShown.length > 0 ? ` (${voBatchesShown.map((_, i) => voLabel(i)).join(", ")})` : ""}
          </button>
        </div>
      )}

      {confirming && (
        <WsDialog
          title={saveLabel}
          sub={anyVo ? "These changes apply to the sales order now. No approval is needed; the VO keeps the record." : "These changes save on the order's lines now."}
          onClose={() => { if (!saving) setConfirming(false); }}
          wide
          footer={(
            <>
              <button type="button" style={btnStyle("outline")} disabled={saving} onClick={() => setConfirming(false)}>Back</button>
              <button type="button" style={btnStyle("teal")} disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : saveLabel}</button>
            </>
          )}
        >
          {batches.map((b) => (
            <div key={b.docNo} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>{batchTitle(b)}</div>
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
                      {l.pos.some((x) => x.poStatus !== "CANCELLED") && (e.qty !== undefined || e.itemCode || e.colour !== undefined || e.variants !== undefined) && (
                        <div style={{ ...metaStyle, color: WS.amber }}>
                          {!contractSo.has(l.soDocNo)
                            ? "On a PO: the PO itself changes only after the PO change is approved."
                            : e.variants !== undefined
                              ? "On a PO: the line saves with the new variants, no VO, and its PO line is flagged for purchasing to tell the supplier."
                              : "On a PO: the PO line is flagged for purchasing to change; the PO itself does not change by itself."}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </WsDialog>
      )}
      {uploading && photos.data && (
        <PhotoUploadDialog projectId={p.projectId} initial={uploading} areas={site.data?.areas ?? []} docs={photos.data.docs} tasks={photos.data.tasks}
          onClose={() => setUploading(null)} onDone={(t) => { setUploading(null); p.onDone(t); photos.reload(); q.reload(); }} />
      )}
      {varying && <VariantDialog {...cell(varying)} onClose={() => setVarying(null)} />}
      {picking && (
        <BetaSkuPicker
          current={picking.itemCode}
          onClose={() => setPicking(null)}
          onPick={(code, name, priceSen) => {
            // A contract line keeps its contract price when the SKU changes (the VO re-adds it at that price).
            setEdit(picking.id, contractSo.has(picking.soDocNo) ? { itemCode: code, pickedName: name } : { itemCode: code, pickedName: name, pickedPriceSen: priceSen });
            setPicking(null);
          }}
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

/** What a band needs to show and set its lines' dates. */
interface BandDates {
  lines: readonly ManagedLine[];
  editable: boolean;
  settable: Record<PlanDate, boolean>;
  busy: Record<PlanDate, boolean>;
  label: string;
  save: (which: PlanDate, value: string) => void;
}

/** A band's date: the one its lines share or "Mixed"; in edit mode a control that sets every line's date. */
function GroupDate({ g, which }: { g: BandDates; which: PlanDate }): ReactElement | null {
  const v = groupDate(g.lines, which);
  const what = which === "orderOn" ? "Processing date" : "Delivery date";
  /* Lines with different dates show their span ("24 Oct - 2 Nov"), not a bare "Mixed" (owner, 24 Oct 2026). */
  const r = groupRange(g.lines, which);
  const span = r.from && r.to ? (r.from === r.to ? dayMonth(r.from) : `${dayMonth(r.from)} - ${dayMonth(r.to)}`) : null;
  const spanText = span ? `${span}${r.unset > 0 ? `, ${r.unset} not set` : ""}` : "Not set";
  const spanTitle = `${what}s of ${g.label} differ: ${span ?? "none set"}${r.unset > 0 ? `; ${r.unset} line${r.unset === 1 ? "" : "s"} not set` : ""}`;
  if (g.editable && g.settable[which]) {
    return (
      <DateControl value={v === "mixed" ? null : v} placeholder={v === "mixed" ? spanText : "Set for all"} busy={g.busy[which]}
        label={`${what} for every line of ${g.label}`} title={v === "mixed" ? `${spanTitle}. Pick a date to give every line the same one.` : `Pick a date to set it on every line of ${g.label}`} onSave={(x) => g.save(which, x)} />
    );
  }
  if (v === null) return null;
  return <span title={v === "mixed" ? spanTitle : `${what}: every line`} style={{ display: "block", fontSize: 12, fontWeight: 600, color: v === "mixed" ? BETA.muted : WS.text2, ...ellipsis }}>{v === "mixed" ? spanText : dayMonthYear(v)}</span>;
}

function Band({ band, label, hint, open, onToggle, columns, dates }: { band: readonly [string, string, string]; label: string; hint: string; open: boolean; onToggle: () => void; columns: readonly PoColumn[]; dates: BandDates }): ReactElement {
  const Icon = open ? ChevronDown : ChevronRight;
  const td: CSSProperties = { padding: "0 6px", background: band[1], borderBottom: `1px solid ${BETA.line}`, verticalAlign: "middle", overflow: "hidden" };
  return (
    <tr>
      {bandParts(columns).map((p, i) => p.kind === "orderOn" || p.kind === "deliverOn"
        ? <td key={i} style={td}><GroupDate g={dates} which={p.kind} /></td>
        : p.kind === "blank" ? <td key={i} colSpan={p.span} style={td} /> : (
      <td key={i} colSpan={p.span} style={{ ...td, padding: 0 }}>
        <button type="button" aria-expanded={open} onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 38, overflow: "hidden", padding: "0 12px 0 8px", border: 0,
            borderLeft: `4px solid ${band[0]}`, background: "transparent", color: band[2], font: "inherit",
            fontSize: 15, fontWeight: 700, cursor: "pointer", textAlign: "left",
          }}>
          <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 auto", ...ellipsis }}>{label}</span>
          <span style={{ flex: "0 1 auto", fontSize: 12, fontWeight: 500, color: WS.text2, ...ellipsis }}>{hint}</span>
        </button>
      </td>
      ))}
    </tr>
  );
}

interface RowCtx {
  l: ManagedLine;
  edit: LineEdit | undefined;
  editable: boolean;
  /** A renovation contract's line: a SKU or qty change raises a contract VO, and keeps the line's price. */
  contract: boolean;
  finance: boolean;
  today: string;
  plansReady: boolean;
  busyKey: string | null;
  refusal: string | null;
  pending: PendingPoChange[];
  setEdit: (patch: Partial<LineEdit>) => void;
  pick: () => void;
  pickVariants: () => void;
  saveDate: (which: PlanDate, value: string) => void;
  setNoPo: (v: boolean) => void;
  saveSupplier: (supplierId: string) => void;
  stock: SoLineCoverage | undefined;
  suppliers: ReadonlyArray<{ id: string; name: string }>;
  grDocs: LineDoc[];
  doDocs: LineDoc[];
  openDoc: (tab: DocTab, no: string) => void;
}

function changed(r: RowCtx): LineEdit | null {
  return effectiveEdit(r.l, r.edit);
}

function SkuCell(r: RowCtx): ReactElement {
  const e = changed(r);
  const code = e?.itemCode ?? r.l.itemCode;
  if (!r.editable || specLocked(r.l)) {
    return (
      <span title={r.editable ? SPEC_LOCKED_NOTE : code} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, ...ellipsis }}>{code}</span>
        {r.editable && <span style={{ ...metaStyle, fontSize: 11, ...ellipsis }}>Received: locked</span>}
      </span>
    );
  }
  return (
    <button type="button" onClick={r.pick} aria-label={`Change SKU ${r.l.itemCode}`} title={e?.itemCode ? `${code} (was ${r.l.itemCode})` : `${code}: change SKU`}
      style={{ ...editInput, width: "100%", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: e?.itemCode ? 700 : 400 }}>
      <span style={{ flex: 1, textAlign: "left", ...ellipsis }}>{code}</span><Search size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
    </button>
  );
}

/** The remark as one line of text (click to edit), or "+ remark"; an input only while editing. */
function RemarkControl(r: RowCtx): ReactElement | null {
  const [open, setOpen] = useState(false);
  const value = r.edit?.remark ?? r.l.remark ?? "";
  const moved = r.edit?.remark !== undefined && r.edit.remark.trim() !== (r.l.remark ?? "").trim();
  if (!r.editable) return value ? <span title={value} style={{ ...metaStyle, ...ellipsis }}>{value}</span> : null;
  if (open) {
    return (
      <input autoFocus aria-label={`Remark for ${r.l.itemCode}`} placeholder="Remark" style={{ ...editInput, height: 24, minHeight: 24, fontSize: 12, flex: "1 1 120px", minWidth: 0 }}
        value={value} onChange={(ev) => r.setEdit({ remark: ev.target.value })} onBlur={() => setOpen(false)}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === "Escape") (ev.target as HTMLInputElement).blur(); }} />
    );
  }
  const link: CSSProperties = { border: 0, padding: 0, background: "transparent", font: "inherit", fontSize: 12, cursor: "pointer", textAlign: "left", ...ellipsis };
  return value
    ? <button type="button" title={`Remark: ${value} (click to edit)`} onClick={() => setOpen(true)} style={{ ...link, color: moved ? BETA.accentInk : WS.text2, fontWeight: moved ? 600 : 400, flex: "0 1 auto" }}>"{value}"</button>
    : <button type="button" aria-label={`Add a remark to ${r.l.itemCode}`} onClick={() => setOpen(true)} style={{ ...link, color: BETA.accent, flex: "0 0 auto" }}>+ remark</button>;
}

function DescCell(r: RowCtx): ReactElement {
  const e = changed(r);
  const name = e?.pickedName ?? r.l.description;
  const meta = r.l.area ?? "";
  const photos = linePhotoSet(r.l);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span title={name} style={{ fontWeight: 600, fontSize: 13, ...ellipsis }}>{name}</span>
        {r.l.goesTo !== "po" && <span style={{ flexShrink: 0 }}><WsBadge tone={TONE_QUIET} size={10}>{r.l.goesTo === "client" ? "Client buys" : "Our works"}</WsBadge></span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {meta && <span title={meta} style={{ ...metaStyle, flex: "0 1 auto", ...ellipsis }}>{meta}</span>}
        <RemarkControl {...r} />
      </div>
      {photoCount(photos) > 0 && <LinePhotoThumbs photos={photos} label={r.l.description || r.l.itemCode} />}
      {r.refusal && <span role="alert" style={{ fontSize: 12, color: WS.red }}>Not saved: {r.refusal}</span>}
      {r.pending.map((c) => (
        <Link key={c.id} to={`/scm/po-amendments/${c.id}`} style={{ fontSize: 12, color: WS.amber, fontWeight: 600, ...ellipsis }}>
          {c.poNumber}: change from {c.voLabel ?? "a VO"} waiting for PO approval
        </Link>
      ))}
    </div>
  );
}

/* The variants the SO line carries. In Edit mode a sofa's or bedframe's are picked with the SO line's own dropdowns,
   from the Maintenance master lists and the SKU's allowed options (owner, 2 Nov 2026); a line whose category has no
   variant options has nothing to pick and uses its remark. A renovation contract saves them on the line (a line a live
   PO buys is replaced by a contract VO); any other order raises its VO. */
function VariantCell(r: RowCtx): ReactElement {
  const e = changed(r);
  const cat = r.l.variantCategory ?? "";
  const shown = e?.variants ? buildVariantSummary(cat, variantsAfter(r.l, e.variants)) || r.l.variantText || "" : r.l.variantText ?? "";
  if (!r.editable || !hasVariantPickers(cat) || specLocked(r.l)) {
    return shown ? <span title={r.editable && specLocked(r.l) ? SPEC_LOCKED_NOTE : shown} style={{ display: "block", fontSize: 12.5, ...ellipsis }}>{shown}</span> : <span style={metaStyle}>-</span>;
  }
  return (
    <button type="button" onClick={r.pickVariants} aria-label={`Change variants of ${r.l.itemCode}`} title={shown ? `${shown} (click to change)` : "Pick variants"}
        style={{ ...editInput, width: "100%", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, fontWeight: e?.variants ? 700 : 400, color: shown ? undefined : BETA.muted }}>
        <span style={{ flex: 1, textAlign: "left", ...ellipsis }}>{shown || "Pick variants"}</span><ChevronDown size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
    </button>
  );
}

/** The SO line's variant pickers for this line; each pick goes into the line's edit, Done closes. */
function VariantDialog(r: RowCtx & { onClose: () => void }): ReactElement {
  const onPo = livePo(r.l);
  return (
    <WsDialog title={`Variants: ${r.l.itemCode}`} sub={r.l.description} onClose={r.onClose} wide
      footer={<button type="button" style={btnStyle("teal")} onClick={r.onClose}>Done</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <RenovationVariantPicker category={r.l.variantCategory ?? ""} itemCode={r.l.itemCode} variants={variantsAfter(r.l, r.edit?.variants)}
          onPatch={(p) => r.setEdit({ variants: { ...r.edit?.variants, ...p } })} />
        {onPo && (
          <p style={{ margin: 0, fontSize: 13, color: WS.amber }}>
            {r.contract
              ? `${onPo.poNumber} already buys this line. The new variants save on the line, and the PO line is flagged for purchasing to tell the supplier.`
              : `${onPo.poNumber} already buys this line. The PO changes only after the PO change from the VO is approved.`}
          </p>
        )}
      </div>
    </WsDialog>
  );
}

function QtyCell(r: RowCtx): ReactElement {
  if (!r.editable) return <span>{r.l.qty}</span>;
  return (
    <input aria-label={`Qty for ${r.l.itemCode}`} type="text" inputMode="numeric" title={r.l.uom} style={{ ...editInput, width: "100%", maxWidth: 64, textAlign: "right" }}
      value={r.edit?.qty === undefined ? String(r.l.qty) : Number.isNaN(r.edit.qty) ? "" : String(r.edit.qty)}
      onChange={(ev) => { const t = ev.target.value.trim(); r.setEdit({ qty: t === "" ? Number.NaN : Number(t) }); }} />
  );
}

function AmountCell(r: RowCtx): ReactElement {
  const e = changed(r);
  const after = amountAfter(r.l, e);
  if (r.l.amountSen === null) return <span>-</span>;
  const moved = after !== null && after !== r.l.amountSen;
  return (
    <span title={moved ? `Was ${money(r.l.amountSen)}` : undefined}
      style={{ display: "block", fontSize: 12.5, fontVariantNumeric: "tabular-nums", fontWeight: moved ? 700 : 400, color: moved ? BETA.accentInk : undefined, ...ellipsis }}>
      {money(after ?? r.l.amountSen)}
    </span>
  );
}

/* The native date input lies, transparent, over the compact date text, and its picker button is stretched over the
   whole input: a real click anywhere opens the browser's own picker. That works inside Property OS's frame too, where
   a script may not open the picker (showPicker is refused in a cross-origin frame). */
const DATE_CSS = `.bpo-date::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:auto;height:auto;margin:0;padding:0;opacity:0;cursor:pointer}`;

/** A whole calendar date (a typed year is complete only at four digits starting 19 or 20). */
const fullDate = (v: string): boolean => /^(19|20)\d\d-\d\d-\d\d$/.test(v);

/** A date as compact text in a yellow edit field; clicking it opens the browser's date picker, and picking or clearing saves it. */
function DateControl({ value, label, title, placeholder = "Set date", busy, late = false, onSave }: {
  value: string | null; label: string; title?: string; placeholder?: string; busy: boolean; late?: boolean; onSave: (v: string) => void;
}): ReactElement {
  const face: CSSProperties = { ...editInput, display: "flex", alignItems: "center", width: "100%", fontSize: 12, height: 26, minHeight: 26, ...(late ? { borderColor: WS.red, color: WS.red, fontWeight: 600 } : value ? {} : { color: BETA.muted }), ...ellipsis };
  return (
    <span style={{ position: "relative", display: "block", minWidth: 0, flexShrink: 0 }} title={title ?? (late ? `${label}: late` : label)}>
      <span aria-hidden="true" style={face}>{busy ? "Saving..." : value ? dayMonthYear(value) : placeholder}</span>
      <input type="date" className="bpo-date" aria-label={label} disabled={busy} defaultValue={value ?? ""} key={value ?? ""}
        onChange={(ev) => {
          const v = ev.target.value;
          if ((v || null) !== (value ?? null) && (v === "" || fullDate(v))) onSave(v);
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: 0, padding: 0, margin: 0 }} />
    </span>
  );
}

function DateButton({ r, which, value, label, late }: { r: RowCtx; which: PlanDate; value: string | null; label: string; late: boolean }): ReactElement {
  return <DateControl value={value} label={`${label} for ${r.l.itemCode}`} busy={r.busyKey === `${r.l.id}:${which}`} late={late} onSave={(v) => r.saveDate(which, v)} />;
}

function DateText({ value, late, title }: { value: string | null; late: boolean; title?: string }): ReactElement {
  return <span title={title} style={{ display: "block", fontSize: 12.5, fontVariantNumeric: "tabular-nums", ...(late ? { color: WS.red, fontWeight: 600 } : value ? {} : { color: BETA.muted }), ...ellipsis }}>{value ? dayMonthYear(value) : "-"}</span>;
}

/** When to place the order: the line's own date, before and after a PO exists. */
function ProcessingCell({ r }: { r: RowCtx }): ReactElement {
  const d = lineDates(r.l);
  const late = lineLate(r.l, r.today) === "order";
  if (r.editable && dateSettable(r.l, "orderOn", r.plansReady)) return <DateButton r={r} which="orderOn" value={d.orderOn} label="Processing date" late={late} />;
  return <FixedDate r={r} which="orderOn" value={d.orderOn} late={late} />;
}

/** When to deliver: the PO line's effective delivery date once a PO holds the line (changed on the PO), else the
    line's own. A date a supplier revised is shown but changed on the PO itself. */
function DeliveryCell({ r }: { r: RowCtx }): ReactElement {
  const d = lineDates(r.l);
  const late = lineLate(r.l, r.today) === "deliver";
  const revised = d.fromPo?.supplierRevised ? `Supplier's revised date on ${d.fromPo.poNumber}; change it on the PO` : undefined;
  if (r.editable && dateSettable(r.l, "deliverOn", r.plansReady)) {
    return <DateButton r={r} which="deliverOn" value={d.deliverOn} label={d.fromPo ? `Delivery date on ${d.fromPo.poNumber}` : "Delivery date"} late={late} />;
  }
  return <FixedDate r={r} which="deliverOn" value={d.deliverOn} late={late} title={revised ?? (d.fromPo ? `Delivery date on ${d.fromPo.poNumber}` : undefined)} />;
}

/** A date that cannot be set here. In Edit mode it says why under the date, so a band that skipped it is understood. */
function FixedDate({ r, which, value, late, title }: { r: RowCtx; which: PlanDate; value: string | null; late: boolean; title?: string }): ReactElement {
  const why = r.editable ? dateFixedReason(r.l, which, r.plansReady) : null;
  if (!why) return <DateText value={value} late={late} title={title} />;
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }} title={`Not set here: ${why}`}>
      <DateText value={value} late={late} />
      <span style={{ ...metaStyle, fontSize: 11, ...ellipsis }}>{why.split(":")[0]}</span>
    </span>
  );
}

/** One line: the PO number and its PO date ("TC-PO-2610-006 · 24 Oct"), changed in the PO's own editor, which the number
    opens from Edit mode. No PO yet: "-" (and, in edit mode, whether the line needs one). */
function PoCell({ r }: { r: RowCtx }): ReactElement {
  const po = livePo(r.l);
  if (po) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, whiteSpace: "nowrap" }} title={`${po.poNumber}${po.poDate ? `, PO date ${dayMonthYear(po.poDate)}` : ""}`}>
        <Link to={`/scm/purchase-orders/${po.poId}${r.editable ? "?edit=1" : ""}`} style={{ fontSize: 12.5, fontWeight: 600, flex: "0 1 auto", ...ellipsis }}>{po.poNumber}</Link>
        <span aria-hidden="true" style={{ ...metaStyle, flexShrink: 0 }}>·</span>
        <span style={{ ...metaStyle, flexShrink: 0 }}>{dayMonth(po.poDate)}</span>
      </div>
    );
  }
  if (r.editable && r.plansReady) {
    return (
      <label title="This line needs no PO" style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: WS.text2, ...ellipsis }}>
        <input type="checkbox" checked={r.l.plan.noPo} disabled={r.busyKey === `${r.l.id}:noPo`} onChange={(ev) => r.setNoPo(ev.target.checked)} style={{ margin: 0, flexShrink: 0 }} />No PO
      </label>
    );
  }
  return <span style={metaStyle}>{r.l.plan.noPo ? "No PO" : "-"}</span>;
}

/** Who the line is bought from: in Edit mode a dropdown until a PO holds the line, then the PO's supplier as text. */
function SupplierCell({ r }: { r: RowCtx }): ReactElement {
  if (r.editable && r.plansReady && picksSupplier(r.l)) return <SupplierPick r={r} />;
  const name = supplierOf(r.l);
  return name ? <span title={name} style={{ display: "block", fontSize: 12.5, ...ellipsis }}>{name}</span> : <span style={metaStyle}>-</span>;
}

/** Who the line is bought from, before Create PO: the SKU's bound suppliers, main first and starred, then every other
    supplier (owner, 4 Nov 2026). Picking one of those binds it to the SKU. */
function SupplierPick({ r }: { r: RowCtx }): ReactElement {
  const choices = r.l.supplierChoices ?? [];
  const others = r.suppliers.filter((s) => !choices.some((c) => c.id === s.id));
  if (choices.length === 0 && others.length === 0) {
    return <span role="note" title="No supplier bound to this SKU: add one in the SKU's suppliers" style={{ fontSize: 11.5, color: WS.amber, lineHeight: 1.25 }}>No supplier bound to this SKU: add one in the SKU's suppliers</span>;
  }
  const busy = r.busyKey === `${r.l.id}:supplier`;
  const picked = [...choices, ...others].some((c) => c.id === r.l.supplierId) ? r.l.supplierId ?? "" : "";
  return (
    <select aria-label={`Supplier for ${r.l.itemCode}`} value={picked} disabled={busy} onChange={(ev) => r.saveSupplier(ev.target.value)}
      title={picked ? undefined : "No supplier on this line yet"}
      style={{ ...editInput, width: "100%", height: 26, minHeight: 26, fontSize: 12, color: picked ? undefined : WS.amber }}>
      {!picked && <option value="">{busy ? "Saving..." : "Pick a supplier"}</option>}
      {choices.map((c) => <option key={c.id} value={c.id}>{c.main ? "\u2605 " : ""}{c.name}{c.main ? " (main)" : ""}</option>)}
      {others.length > 0 && <optgroup label="Other suppliers">{others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
    </select>
  );
}

function linePhotoSet(l: ManagedLine): LinePhotoSet {
  return {
    so: l.photoKeys.length ? { docNo: l.soDocNo, itemId: l.id, keys: l.photoKeys } : null,
    po: l.pos.filter((x) => x.photoKeys.length > 0).map((x) => ({ poId: x.poId, poLineId: x.poLineId, poNumber: x.poNumber, keys: x.photoKeys })),
    sku: l.skuPhotos,
  };
}

function grState(l: ManagedLine): "yes" | "part" | "no" | null {
  return l.goesTo !== "po" && l.pos.length === 0 ? null : l.gr;
}

/** The line's stock, from the same coverage and the same pill as the sales order page. */
function StockCell({ r }: { r: RowCtx }): ReactElement {
  const c = r.stock;
  const inFull = r.l.do === "yes";
  return (
    <span title={c?.coverage_po ? `Incoming ${c.coverage_po}${c.coverage_eta ? `, ${c.coverage_eta}` : ""}` : undefined}>
      <SoStockPill line={{ item_group: r.l.itemGroup, delivered_qty: inFull ? r.l.qty : 0, remaining_qty: inFull ? 0 : r.l.qty, stock_state: c?.stock_state ?? null,
        stock_status_effective: (c?.stock_status_effective ?? null) as "READY" | "PARTIAL" | "PENDING" | null, non_selling_warehouse: c?.non_selling_warehouse ?? null }} />
    </span>
  );
}

const LINE_CELLS: Record<PoColumn, (r: RowCtx) => ReactElement> = {
  sku: (r) => <SkuCell {...r} />, desc: (r) => <DescCell {...r} />, variants: (r) => <VariantCell {...r} />, qty: (r) => <QtyCell {...r} />, amount: (r) => <AmountCell {...r} />,
  orderOn: (r) => <ProcessingCell r={r} />, deliverOn: (r) => <DeliveryCell r={r} />, supplier: (r) => <SupplierCell r={r} />, stock: (r) => <StockCell r={r} />, po: (r) => <PoCell r={r} />,
  gr: (r) => <DocCell docs={r.grDocs} state={grState(r.l)} tab="gr" open={r.openDoc} />, do: (r) => <DocCell docs={r.doDocs} state={r.l.do} tab="do" open={r.openDoc} />,
};

function LineRow(r: RowCtx & { columns: readonly PoColumn[] }): ReactElement {
  const touched = changed(r) !== null;
  return (
    <tr style={{ opacity: r.l.goesTo === "client" ? 0.75 : 1, background: touched ? TONES.amber.soft : undefined }}>
      {r.columns.map((c, i) => (
        <td key={c} style={{ ...cellStyle, paddingLeft: i === 0 ? 12 : cellStyle.paddingLeft, textAlign: COLUMN_HEAD[c].right ? "right" : undefined }}>{LINE_CELLS[c](r)}</td>
      ))}
    </tr>
  );
}

/** One line as a stacked card, when the tab is narrower than the table needs. */
function LineCard(r: RowCtx): ReactElement {
  const touched = changed(r) !== null;
  const field = (label: string, child: ReactElement): ReactElement => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><span style={metaStyle}>{label}</span>{child}</div>
  );
  return (
    <li style={{ padding: "10px 12px", borderBottom: `1px solid ${WS.rowLine}`, display: "flex", flexDirection: "column", gap: 8, opacity: r.l.goesTo === "client" ? 0.75 : 1, background: touched ? TONES.amber.soft : BETA.surface }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
        <SkuCell {...r} />
        {r.finance && <AmountCell {...r} />}
      </div>
      <DescCell {...r} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 72px", gap: 8 }}>
        {field("Variants", <VariantCell {...r} />)}
        {field(`Qty (${r.l.uom})`, <QtyCell {...r} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {field("Processing", <ProcessingCell r={r} />)}
        {field("Delivery", <DeliveryCell r={r} />)}
        {field("Supplier", <SupplierCell r={r} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {field("PO", <PoCell r={r} />)}
        {field("GR", <DocCell docs={r.grDocs} state={grState(r.l)} tab="gr" open={r.openDoc} />)}
        {field("DO", <DocCell docs={r.doDocs} state={r.l.do} tab="do" open={r.openDoc} />)}
      </div>
    </li>
  );
}

function SaveResult({ posted, onClose }: { posted: PostedVo[]; onClose: () => void }): ReactElement {
  const ok = posted.every((x) => x.applied);
  return (
    <div role="status" style={{ border: `1px solid ${ok ? TONES.accent.line : TONES.red.line}`, background: ok ? TONES.accent.soft : TONES.red.soft, borderRadius: 10, padding: "10px 12px", fontSize: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {posted.map((x) => (
          <div key={x.docNo}>
            {x.applied
              ? <span style={{ color: WS.green }}><b>Saved.</b> {x.docNo} changed{x.amendmentNo ? ` (${x.amendmentNo}); the VO is in the VO tab.` : "."}</span>
              : <span style={{ color: WS.red }}><b>{x.docNo} not changed.</b> {x.refusal}</span>}
            {(x.poFlags ?? 0) > 0 && (
              <div style={{ color: WS.amber }}>
                {x.amendmentNo ? `${x.amendmentNo} raised: the` : "The"} PO line{x.poFlags === 1 ? " is" : "s are"} flagged for purchasing.
              </div>
            )}
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
