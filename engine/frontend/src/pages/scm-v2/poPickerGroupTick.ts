import type { OutstandingSoItem } from '../../vendor/scm/lib/suppliers-queries';

export interface GroupTickPlan {
  /** The lines to tick: the chosen supplier's, plus lines with no supplier (they ride any PO, as when ticked one by one). */
  rideOn: OutstandingSoItem[];
  /** Lines left unticked because they belong to another supplier. */
  skipped: number;
  supplier: string | null;
}

/** One PO takes one supplier: the locked one, else the project's first line that has a supplier. */
export function planGroupTick(eligible: readonly OutstandingSoItem[], lockedSupplier: string | null): GroupTickPlan {
  const supplier = lockedSupplier ?? eligible.find((r) => r.mainSupplierCode)?.mainSupplierCode ?? null;
  const rideOn = eligible.filter((r) => !r.mainSupplierCode || !supplier || r.mainSupplierCode === supplier);
  return { rideOn, skipped: eligible.length - rideOn.length, supplier };
}
