export interface ContractInput {
  ownerId?: string; ownerName?: string; model?: string; managementFeePct?: number; feePct?: number; grrAmount?: number;
  startsOn?: string; startedOn?: string; renewsOn?: string | null; endsOn?: string | null; offerLetter?: string | null;
}

/** The screens use two spellings (managementFeePct / feePct, startsOn / startedOn); this reads either. */
export function normalise(b: ContractInput) {
  const model = b.model ?? 'management';
  const fee = b.managementFeePct ?? b.feePct ?? (model === 'grr' ? 0 : undefined);
  return { model, fee, grr: b.grrAmount ?? 0, starts: b.startsOn ?? b.startedOn, renews: b.renewsOn || null, ends: b.endsOn || null };
}

/** Field-keyed problems, empty when fine. `requireAll` is true for a new contract, false for a partial change. */
export function invalidContract(b: ContractInput, requireAll: boolean): Record<string, string> {
  const n = normalise(b), f: Record<string, string> = {};
  if (!['management', 'grr'].includes(n.model)) f.model = 'Pick a fee model.';
  if ((requireAll || n.fee !== undefined) && (typeof n.fee !== 'number' || n.fee < 0 || n.fee > 100)) f.managementFeePct = 'Enter a percentage between 0 and 100.';
  if (!Number.isInteger(n.grr) || n.grr < 0) f.grrAmount = 'Enter the monthly rent in whole sen.';
  if (n.model === 'grr' && n.grr <= 0) f.grrAmount = 'Enter the guaranteed monthly rent.';
  if (requireAll && !n.starts) f.startsOn = 'A start date is required.';
  if (n.starts && n.renews && n.renews <= n.starts) f.renewsOn = 'Renewal must be after the start date.';
  return f;
}
