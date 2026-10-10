/* Seams between the renovation sales documents (phase 2) and the renovation
   project (phase 3).

   - onRenovationSoLinesChanged(docNo, db): called AFTER COMMIT whenever a
     renovation contract's lines change (quotation converted, VO applied). With a
     connection it runs phase 3's onContractLinesChanged: the project's trade
     tasks are synced (a VO omitting a trade auto-skips its task, bringing it
     back re-opens it) and its cached current stage is rewritten. Stage
     auto-skip / re-open itself needs no write: stage views are derived from the
     contract lines on every read (services/renovation/stages.ts). Extra
     listeners may register too. Anything that throws is logged and never fails
     the sale.
   - projectHandoverState(db, projectId): whether the project was handed over,
     read by the PO payment schedule to make retention payable. Phase 3's
     readProjectHandoverState reads public.project_handovers; no project, no
     connection or a failed read answers 'unknown', which keeps retention closed
     (fail closed). */

import { renoDbOf, type RenoDb, type UnsafeRunner } from './renovation-db';
import { d1FromRenoDb } from '../../services/renovation/dbBridge';
import { onContractLinesChanged } from '../../services/renovation/contractSync';
import { readProjectHandoverState } from '../../services/renovation/handover';

export type RenovationSoLinesListener = (docNo: string) => Promise<void> | void;

const listeners: RenovationSoLinesListener[] = [];

export function registerRenovationSoLinesListener(fn: RenovationSoLinesListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export async function onRenovationSoLinesChanged(docNo: string, db?: RenoDb | UnsafeRunner | null): Promise<void> {
  if (db) {
    try {
      await onContractLinesChanged(d1FromRenoDb(renoDbOf(db)), docNo);
    } catch (err) {
      console.error(`[renovation] project refresh after lines changed failed for ${docNo}:`, err);
    }
  }
  for (const fn of [...listeners]) {
    try {
      await fn(docNo);
    } catch (err) {
      console.error(`[renovation] lines-changed listener failed for ${docNo}:`, err);
    }
  }
}

export type HandoverState = 'handed_over' | 'not_handed_over' | 'unknown';

export async function projectHandoverState(db: RenoDb | UnsafeRunner | null | undefined, projectId: number | null): Promise<HandoverState> {
  if (!db || projectId == null) return 'unknown';
  try {
    return await readProjectHandoverState(d1FromRenoDb(renoDbOf(db)), Number(projectId));
  } catch (err) {
    console.error('[renovation] handover state read failed', err);
    return 'unknown';
  }
}
