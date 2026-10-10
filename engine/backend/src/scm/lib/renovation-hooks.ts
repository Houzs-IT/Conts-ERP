/* Seams between the renovation sales documents (phase 2) and the renovation
   project (phase 3). Phase 2 owns this file's shape; phase 3 fills it in.

   - onRenovationSoLinesChanged(docNo): called AFTER COMMIT whenever a renovation
     contract's lines change (quotation converted, VO applied). Phase 3 registers
     a listener (stage auto-skip / re-open, trade tasks). A listener that throws
     is logged and never fails the sale.
   - projectHandoverState(db, projectId): whether the project was handed over,
     read by the PO payment schedule to make retention payable. Answers 'unknown'
     until phase 3 replaces the body with a read of public.project_handovers;
     'unknown' keeps retention closed (fail closed). */

import type { RenoDb } from './renovation-db';

export type RenovationSoLinesListener = (docNo: string) => Promise<void> | void;

const listeners: RenovationSoLinesListener[] = [];

export function registerRenovationSoLinesListener(fn: RenovationSoLinesListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export async function onRenovationSoLinesChanged(docNo: string): Promise<void> {
  for (const fn of [...listeners]) {
    try {
      await fn(docNo);
    } catch (err) {
      console.error(`[renovation] lines-changed listener failed for ${docNo}:`, err);
    }
  }
}

export type HandoverState = 'handed_over' | 'not_handed_over' | 'unknown';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function projectHandoverState(_db: RenoDb | unknown, _projectId: number | null): Promise<HandoverState> {
  return 'unknown';
}
