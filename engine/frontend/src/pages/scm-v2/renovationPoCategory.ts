/* Renovation mode (Conts): from 14 Oct 2026 (mig 0116) a renovation purchase order held one category and the
   database refused a line of another. The owner lifted that on 19 Nov 2026 (migration 0345): a PO may mix categories.
   The refusal parser stays so a database that has not yet taken 0345 still answers in plain words naming the item
   and both categories, never a generic failed save. Pure. */

import { mfgCategoryLabel } from "../../vendor/shared/product-categories";
import type { RenoDocInfo } from "../../vendor/scm/lib/renovation-doc-print";

/** How the trigger's message starts (migrations-pg/0116_reno_doc_flow.sql). */
export const RENO_PO_CATEGORY_REFUSAL = "A renovation purchase order holds one category";

const groupLabel = (code: string) => mfgCategoryLabel(code) || code;

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

/** Nothing clashes any more: a purchase order may mix categories (owner, 19 Nov 2026; migration 0345 lifted the
    database's refusal), so no line is held back before Save. Kept so the PO and production-order screens keep one
    call site if a rule ever returns. The parameters stay for that reason. */
export function renoPoCategoryClashes(
  _info: RenoDocInfo | null,
  _lines: readonly RenoPoDraftLine[],
  _groupOfCode: (code: string) => string | null | undefined,
): Map<string, string> {
  return new Map<string, string>();
}
