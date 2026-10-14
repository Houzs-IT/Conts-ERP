/* Renovation mode (Conts, owner 14 Oct 2026, mig 0116): a renovation purchase order holds one category. The
   database refuses a line of another category (scm.reno_flow_po_item, check_violation). This lets the existing PO
   screen say so next to the line before Save, and turn the server's refusal into the same plain sentence instead of
   a generic failed save. Pure. */

import { RENOVATION_GROUPS } from "../../vendor/shared/renovation-catalog";
import type { RenoDocInfo } from "../../vendor/scm/lib/renovation-doc-print";

/** How the trigger's message starts (migrations-pg/0116_reno_doc_flow.sql). */
export const RENO_PO_CATEGORY_REFUSAL = "A renovation purchase order holds one category";

const groupLabel = (code: string) => RENOVATION_GROUPS.find((g) => g.code === code)?.label ?? code;

const sentence = (po: string, itemCode: string, line: string) =>
  `${RENO_PO_CATEGORY_REFUSAL}: this PO is ${groupLabel(po)}, the line ${itemCode} is ${groupLabel(line)}. Raise a separate PO for ${groupLabel(line)}.`;

/** The server's one-category refusal from a failed save (the error's message or its JSON body's reason), in plain
    words (category names, not codes), or null when the failure is something else. */
export function renoPoCategoryRefusal(e: unknown): string | null {
  const err = e as { message?: unknown; body?: unknown } | null;
  const texts: string[] = [];
  if (typeof err?.message === "string") texts.push(err.message);
  if (typeof err?.body === "string") {
    texts.push(err.body);
    try {
      const j = JSON.parse(err.body) as { reason?: unknown; message?: unknown; error?: unknown };
      for (const v of [j.reason, j.message, j.error]) if (typeof v === "string") texts.push(v);
    } catch { /* not JSON */ }
  }
  for (const t of texts) {
    const at = t.indexOf(RENO_PO_CATEGORY_REFUSAL);
    if (at < 0) continue;
    const raw = t.slice(at).replace(/["}\s]+$/, "").trim();
    const m = /this PO is (\S+), the line (.*?) is (\S+)\. Raise a separate PO/.exec(raw);
    return m ? sentence(m[1]!, m[2]!, m[3]!) : raw;
  }
  return null;
}

export interface RenoPoDraftLine { rid: string; itemId?: string; itemCode: string }

/** For each NEW line (the trigger checks inserts only) whose product is of another category than the PO, the
    sentence the database would answer with. Empty outside renovation mode, or for a PO with no project. The PO's
    category is its own, else that of a line already on it, else the first new line's. */
export function renoPoCategoryClashes(
  info: RenoDocInfo | null,
  lines: readonly RenoPoDraftLine[],
  groupOfCode: (code: string) => string | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!info?.info?.projectId) return out;
  let po: string | null = info.info.categoryGroup || null;
  if (!po) po = Object.values(info.lines).map((l) => l.categoryGroup).find(Boolean) ?? null;
  // Lines saved since the page read the PO's information.
  if (!po) po = lines.filter((l) => l.itemId).map((l) => groupOfCode(l.itemCode)).find(Boolean) ?? null;
  for (const l of lines) {
    if (l.itemId || !l.itemCode.trim()) continue;
    const g = groupOfCode(l.itemCode);
    if (!g) continue;
    if (!po) { po = g; continue; }
    if (g !== po) out.set(l.rid, sentence(po, l.itemCode, g));
  }
  return out;
}
