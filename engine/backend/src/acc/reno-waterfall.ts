// ----------------------------------------------------------------------------
// The renovation revenue waterfall (spec 2.3, plan Task 2) — pure, no I/O.
//
// What an invoice books as revenue is spread over the contract's lines in a fixed order, each tier filled before the
// next starts: Service → Fixture (WORKS, LIGHTING) → Carpentry (BUILTIN) → Furniture (FURNITURE, APPLIANCE, SOFT) →
// Airbnb. Within a tier, the fill is shared in proportion to the lines' contract amounts, largest remainder — the
// invoice total is the law, so a target always sums to exactly the cumulative billed.
//
// It is cumulative: waterfallTarget says what each line's revenue should be after `cumulativeSen` of net billing, and
// allocationDelta says what one event must post to get there from what is already allocated. A lower cumulative
// (a credit note, a VO that lowers a tier) gives back from the last tier filled, because the target simply stops
// earlier.
// ----------------------------------------------------------------------------

export type RevenueLine = { key: string; group: string; subCategory: string | null; amountSen: number };

export const TIERS: readonly (readonly string[])[] = [
  ['SERVICE'],
  ['WORKS', 'LIGHTING'],
  ['BUILTIN'],
  ['FURNITURE', 'APPLIANCE', 'SOFT'],
  ['AIRBNB'],
];

const tierOf = (group: string): number => {
  const g = group.trim().toUpperCase();
  const i = TIERS.findIndex((t) => t.includes(g));
  /* A group outside the tiers goes after AIRBNB, in one last tier. */
  return i < 0 ? TIERS.length : i;
};

/** `fill` shared over `lines` in proportion to their amounts; floors first, then one sen each to the largest
    remainders (ties: the earlier line). Exact in BigInt — sen × sen can pass 2^53. */
function shareByAmount(lines: RevenueLine[], fill: number, out: Map<string, number>): void {
  const total = lines.reduce((s, l) => s + BigInt(l.amountSen), 0n);
  const f = BigInt(fill);
  const parts = lines.map((l, i) => {
    const num = f * BigInt(l.amountSen);
    return { key: l.key, i, floor: num / total, rem: num % total };
  });
  let left = f - parts.reduce((s, p) => s + p.floor, 0n);
  const byRem = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const p of byRem) {
    if (left <= 0n) break;
    p.floor += 1n;
    left -= 1n;
  }
  for (const p of parts) out.set(p.key, (out.get(p.key) ?? 0) + Number(p.floor));
}

/** Revenue per line key after `cumulativeSen` of net billing. Every line has an entry (0 when not reached). */
export function waterfallTarget(lines: RevenueLine[], cumulativeSen: number): Map<string, number> {
  if (!Number.isSafeInteger(cumulativeSen) || cumulativeSen < 0) {
    throw new Error(`waterfallTarget: cumulative billing must be a whole number of sen, not below 0 (got ${cumulativeSen})`);
  }
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountSen) || l.amountSen < 0) {
      throw new Error(`waterfallTarget: line ${l.key} has amount ${l.amountSen} — contract lines must be whole sen, not below 0`);
    }
  }

  const out = new Map<string, number>(lines.map((l) => [l.key, 0]));
  const tiers: RevenueLine[][] = Array.from({ length: TIERS.length + 1 }, () => []);
  for (const l of lines) tiers[tierOf(l.group)].push(l);
  const filled = tiers.filter((t) => t.some((l) => l.amountSen > 0));

  if (cumulativeSen > 0 && filled.length === 0) {
    throw new Error('waterfallTarget: billing on a contract with no amount on any line');
  }

  let left = cumulativeSen;
  filled.forEach((tier, idx) => {
    if (left <= 0) return;
    const capacity = tier.reduce((s, l) => s + l.amountSen, 0);
    /* The last tier also takes anything billed above the contract (over-billed), so the target still sums exactly. */
    const fill = idx === filled.length - 1 ? left : Math.min(left, capacity);
    shareByAmount(tier, fill, out);
    left -= fill;
  });
  return out;
}

/** What to post to move from `already` to `target`: per key, target − already, non-zero differences only.
    Largest remainder is worked out afresh at each cumulative, so a line can sit 1 sen lower at a bigger total (lines
    of 1, 3, 3 sen: [1, 1, 1] at 3, [0, 2, 2] at 4) — a positive invoice may then carry a −1 sen line. Kept on purpose:
    the journal groups by account, the invoice is one line, and the deltas still sum to exactly the invoice amount. */
export function allocationDelta(target: Map<string, number>, already: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of new Set([...target.keys(), ...already.keys()])) {
    const d = (target.get(key) ?? 0) - (already.get(key) ?? 0);
    if (d !== 0) out.set(key, d);
  }
  return out;
}
