/* The VO room editor's model (owner, 23 Nov 2026): the contract's live lines by room, with the VO's in-place edits laid
   over them. The server turns the same edits into the VO's add and omit lines (renovation-vo.ts buildEditSections). */

import { lineAmounts } from '../../vendor/shared/renovation-money';
import type { DocLine, DocSection, VoEdits, VoLineAdd, VoLineEdit } from '../../lib/renovation/api';

export type RowKind = 'same' | 'changed' | 'removed' | 'added';

export interface RoomRow {
  key: string;
  kind: RowKind;
  /** The contract line, or null for a line this VO adds. */
  line: DocLine | null;
  soItemId: string | null;
  /** Index into `edits.adds` for a line this VO adds. */
  addIndex: number | null;
  sku: string | null;
  oldSku: string | null;
  name: string;
  oldName: string | null;
  qty: number;
  oldQty: number | null;
  unitPriceSen: number;
  oldPriceSen: number | null;
  measured: boolean;
  amountSen: number;
  deltaSen: number;
}

export interface Room { name: string; rows: RoomRow[]; deltaSen: number }

export interface RoomTotals { addSen: number; omitSen: number; netSen: number; changed: number; added: number; removed: number }

export const NEW_ROOM_FALLBACK = 'Additional works';

const netOf = (l: Pick<DocLine, 'kind' | 'qty' | 'measureMilli' | 'measureUom' | 'uom' | 'unitPriceSen' | 'discountBp' | 'amountOverrideSen' | 'isFoc'>): number =>
  lineAmounts({ kind: l.kind, qty: l.qty, measureMilli: l.measureMilli ?? null, measureUom: l.measureUom, uom: l.uom, unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc }).netSen;

/** A contract line the VO can change: priced, live, with an SO line behind it, outside a lump-sum section. */
export function editableLines(sections: DocSection[]): Array<{ room: string; line: DocLine }> {
  return sections.flatMap((s) => (s.lumpSumSen !== null ? [] : s.lines
    .filter((l) => (l.kind === 'ITEM' || l.kind === 'CHILD') && l.soItemId && !l.omittedByVoId && !l.soItemCancelled)
    .map((line) => ({ room: line.room?.trim() || s.heading.trim() || NEW_ROOM_FALLBACK, line }))));
}

function rowOf(line: DocLine, e: VoLineEdit | undefined): RoomRow {
  const oldNet = netOf(line);
  const base = {
    key: line.soItemId!, line, soItemId: line.soItemId!, addIndex: null, oldSku: null, oldName: null, oldQty: null, oldPriceSen: null,
    measured: line.measureMilli != null,
  };
  if (e?.remove) {
    return { ...base, kind: 'removed', sku: line.itemCode, name: line.description, qty: line.qty, unitPriceSen: line.unitPriceSen, amountSen: oldNet, deltaSen: -oldNet };
  }
  const swapped = e?.itemCode !== undefined && e.itemCode !== line.itemCode;
  const qty = e?.qty ?? line.qty;
  const price = e?.unitPriceSen ?? line.unitPriceSen;
  const moved = swapped || qty !== line.qty || price !== line.unitPriceSen;
  if (!moved) {
    return { ...base, kind: 'same', sku: line.itemCode, name: line.description, qty, unitPriceSen: price, amountSen: oldNet, deltaSen: 0 };
  }
  const newNet = netOf({ ...line, qty, unitPriceSen: price, amountOverrideSen: null });
  return {
    ...base, kind: 'changed',
    sku: swapped ? e!.itemCode! : line.itemCode, oldSku: swapped ? line.itemCode : null,
    name: swapped ? e!.label || e!.itemCode! : line.description, oldName: swapped ? line.description : null,
    qty, oldQty: qty !== line.qty ? line.qty : null, unitPriceSen: price, oldPriceSen: price !== line.unitPriceSen ? line.unitPriceSen : null,
    amountSen: newNet, deltaSen: newNet - oldNet,
  };
}

function addRow(a: VoLineAdd, i: number): RoomRow {
  const amt = a.qty * a.unitPriceSen;
  return {
    key: `add-${i}`, kind: 'added', line: null, soItemId: null, addIndex: i, sku: a.itemCode, oldSku: null, name: a.label || a.itemCode, oldName: null,
    qty: a.qty, oldQty: null, unitPriceSen: a.unitPriceSen, oldPriceSen: null, measured: false, amountSen: amt, deltaSen: amt,
  };
}

/** The contract by room in contract order, edits applied; rooms only this VO adds come last. */
export function roomsOf(sections: DocSection[], edits: VoEdits): Room[] {
  const byItem = new Map(edits.lines.map((e) => [e.soItemId, e]));
  const rooms = new Map<string, RoomRow[]>();
  const put = (room: string, r: RoomRow) => rooms.set(room, [...(rooms.get(room) ?? []), r]);
  for (const { room, line } of editableLines(sections)) put(room, rowOf(line, byItem.get(line.soItemId!)));
  edits.adds.forEach((a, i) => put(a.room.trim() || NEW_ROOM_FALLBACK, addRow(a, i)));
  return [...rooms].map(([name, rows]) => ({ name, rows, deltaSen: rows.reduce((t, r) => t + r.deltaSen, 0) }));
}

export function totalsOf(rooms: Room[]): RoomTotals {
  const rows = rooms.flatMap((r) => r.rows);
  const addSen = rows.reduce((t, r) => t + Math.max(0, r.deltaSen), 0);
  const omitSen = rows.reduce((t, r) => t + Math.min(0, r.deltaSen), 0);
  return {
    addSen, omitSen, netSen: addSen + omitSen,
    changed: rows.filter((r) => r.kind === 'changed').length,
    added: rows.filter((r) => r.kind === 'added').length,
    removed: rows.filter((r) => r.kind === 'removed').length,
  };
}

/* ---------- edits ---------- */

/** Drop what equals the contract line; an edit with nothing left goes. */
function settle(edits: VoEdits, line: DocLine, e: VoLineEdit): VoEdits {
  const rest = edits.lines.filter((x) => x.soItemId !== e.soItemId);
  if (e.remove) return { ...edits, lines: [...rest, { soItemId: e.soItemId, remove: true }] };
  const out: VoLineEdit = { soItemId: e.soItemId };
  if (e.itemCode !== undefined && e.itemCode !== line.itemCode) { out.itemCode = e.itemCode; if (e.label) out.label = e.label; }
  if (e.qty !== undefined && e.qty !== line.qty) out.qty = e.qty;
  if (e.unitPriceSen !== undefined && e.unitPriceSen !== line.unitPriceSen) out.unitPriceSen = e.unitPriceSen;
  return { ...edits, lines: Object.keys(out).length > 1 ? [...rest, out] : rest };
}

const editOf = (edits: VoEdits, line: DocLine): VoLineEdit => {
  const e = edits.lines.find((x) => x.soItemId === line.soItemId);
  return e && !e.remove ? { ...e } : { soItemId: line.soItemId! };
};

/** Change a contract line's qty; 0 or less removes it. */
export function setLineQty(edits: VoEdits, line: DocLine, qty: number): VoEdits {
  if (qty < 1) return removeLine(edits, line);
  return settle(edits, line, { ...editOf(edits, line), qty: Math.trunc(qty) });
}

export function setLinePrice(edits: VoEdits, line: DocLine, unitPriceSen: number): VoEdits {
  return settle(edits, line, { ...editOf(edits, line), unitPriceSen: Math.max(0, Math.round(unitPriceSen)) });
}

/** Another SKU in the line's place, at the new SKU's selling price when it has one. */
export function swapLine(edits: VoEdits, line: DocLine, p: { code: string; name: string; sellPriceSen: number }): VoEdits {
  const e = editOf(edits, line);
  if (p.code === line.itemCode) return settle(edits, line, { ...e, itemCode: undefined, label: undefined, unitPriceSen: undefined });
  return settle(edits, line, { ...e, itemCode: p.code, label: p.name, unitPriceSen: p.sellPriceSen > 0 ? p.sellPriceSen : e.unitPriceSen });
}

export function removeLine(edits: VoEdits, line: DocLine): VoEdits {
  return settle(edits, line, { soItemId: line.soItemId!, remove: true });
}

export function undoLine(edits: VoEdits, soItemId: string): VoEdits {
  return { ...edits, lines: edits.lines.filter((x) => x.soItemId !== soItemId) };
}

export function addLine(edits: VoEdits, room: string, p: { code: string; name: string; sellPriceSen: number }, fromPackageId: string | null = null): VoEdits {
  return { ...edits, adds: [...edits.adds, { room: room.trim() || NEW_ROOM_FALLBACK, itemCode: p.code, label: p.name, qty: 1, unitPriceSen: Math.max(0, p.sellPriceSen), fromPackageId }] };
}

/** Change an added line's qty; 0 or less takes it out. */
export function setAddQty(edits: VoEdits, i: number, qty: number): VoEdits {
  if (qty < 1) return dropAdd(edits, i);
  return { ...edits, adds: edits.adds.map((a, j) => (j === i ? { ...a, qty: Math.trunc(qty) } : a)) };
}

export function setAddPrice(edits: VoEdits, i: number, unitPriceSen: number): VoEdits {
  return { ...edits, adds: edits.adds.map((a, j) => (j === i ? { ...a, unitPriceSen: Math.max(0, Math.round(unitPriceSen)) } : a)) };
}

export function dropAdd(edits: VoEdits, i: number): VoEdits {
  return { ...edits, adds: edits.adds.filter((_, j) => j !== i) };
}

/** A package's ticked lines (from its confirm dialog) as added lines; lines with no SKU cannot be added by a VO. */
export function packageAdds(edits: VoEdits, sections: DocSection[], packageId: string | null, fallbackRoom: string, replace: boolean): { edits: VoEdits; skipped: number } {
  const kept = replace && packageId ? edits.adds.filter((a) => a.fromPackageId !== packageId) : edits.adds;
  let skipped = 0;
  const added: VoLineAdd[] = [];
  for (const s of sections) {
    for (const l of s.lines) {
      if (l.kind !== 'ITEM' && l.kind !== 'CHILD') continue;
      if (!l.itemCode || l.qty < 1 || l.measureMilli != null) { skipped += 1; continue; }
      added.push({ room: s.heading.trim() || fallbackRoom.trim() || NEW_ROOM_FALLBACK, itemCode: l.itemCode, label: l.description, qty: l.qty, unitPriceSen: l.unitPriceSen, fromPackageId: packageId });
    }
  }
  return { edits: { ...edits, adds: [...kept, ...added] }, skipped };
}

export const EMPTY_EDITS: VoEdits = { lines: [], adds: [] };

export const hasEdits = (e: VoEdits): boolean => e.lines.length > 0 || e.adds.length > 0;
