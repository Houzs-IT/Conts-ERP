import type { OutstandingSoItem } from '../../vendor/scm/lib/suppliers-queries';

export interface GroupTickPlan {
  rideOn: OutstandingSoItem[];
  skipped: number;
  supplier: string | null;
}

export function planGroupTick(eligible: readonly OutstandingSoItem[], lockedSupplier: string | null): GroupTickPlan {
  const supplier = lockedSupplier ?? eligible.find((r) => r.mainSupplierCode)?.mainSupplierCode ?? null;
  const rideOn = eligible.filter((r) => !r.mainSupplierCode || !supplier || r.mainSupplierCode === supplier);
  return { rideOn, skipped: eligible.length - rideOn.length, supplier };
}
