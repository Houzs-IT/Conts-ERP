/* Handover state for other modules: phase 2's projectHandoverState
   (scm/lib/renovation-hooks.ts) answers with this. Retention on a
   subcontractor PO becomes payable only after 'handed_over'. A read failure
   answers 'unknown', which keeps retention unpayable (fails closed). */

import type { Db } from "./load";

export type HandoverState = "handed_over" | "not_handed_over" | "unknown";

export async function readProjectHandoverState(db: Db, projectId: number): Promise<HandoverState> {
  try {
    const row = await db.prepare(`SELECT 1 AS ok FROM public.project_handovers WHERE project_id = ?`).bind(projectId).first<{ ok: number }>();
    return row ? "handed_over" : "not_handed_over";
  } catch (e) {
    console.error("[renovation] handover state read failed", e);
    return "unknown";
  }
}
