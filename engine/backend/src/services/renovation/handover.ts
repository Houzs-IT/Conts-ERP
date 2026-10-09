/* Handover state for other modules (integration contract: phase 2's
   scm/lib/renovation-hooks.ts projectHandoverState returns 'unknown' until phase
   3 lands; once both are on main its body calls this). Retention on a
   subcontractor PO becomes payable only after 'handed_over'. A read failure
   answers 'unknown', which keeps retention unpayable (fails closed). */

import type { Db } from "./load";

export type HandoverState = "handed_over" | "not_handed_over" | "unknown";

export async function readProjectHandoverState(db: Db, projectId: number): Promise<HandoverState> {
  try {
    const row = await db.prepare(`SELECT 1 AS ok FROM project_handovers WHERE project_id = ?`).bind(projectId).first<{ ok: number }>();
    return row ? "handed_over" : "not_handed_over";
  } catch (e) {
    console.error("[renovation] handover state read failed", e);
    return "unknown";
  }
}
