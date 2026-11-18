// A stock group and its purchase account fill each other on a purchase invoice line (chew, 18 Nov 2026: stock codes are
// not complete yet, so a line may name its account instead of an item; the account defaults from the stock group, and
// an account names its group). Group codes compare case-folded: products carry them lower-case, the registry upper.
import { useMemo } from 'react';
import { useItemGroups } from './accounting-phase1-queries';

/** A stock group and the account its goods are bought on (Item group accounts), null when not bound yet. */
export type ItemGroupAccount = { code: string; name: string; purchaseAccount: string | null };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();

/** The group fills the account; a group with no account bound leaves it as it was. */
export const accountForGroup = (groups: readonly ItemGroupAccount[], code: string): string | null =>
  groups.find((g) => same(g.code, code))?.purchaseAccount ?? null;

/** The account fills the group when exactly one group buys on it; otherwise the line keeps the group it had, unless
    that group buys on another account. */
export const groupForAccount = (groups: readonly ItemGroupAccount[], account: string, had: string | null | undefined): string | null => {
  const on = groups.filter((g) => g.purchaseAccount === account);
  if (on.length === 1) return on[0]!.code;
  const kept = groups.find((g) => same(g.code, had));
  return kept && (kept.purchaseAccount == null || kept.purchaseAccount === account) ? kept.code : null;
};

/** The active stock groups with this company's purchase account (the first company the registry answers for). */
export function useItemGroupAccounts(): ItemGroupAccount[] {
  const q = useItemGroups();
  return useMemo(() => {
    const co = q.data?.companies.at(0)?.id;
    return (q.data?.groups ?? []).filter((g) => g.isActive).map((g) => {
      const bound: { purchase?: string } | undefined = co == null ? undefined : g.bindings[String(co)];
      return { code: g.code, name: g.name, purchaseAccount: bound?.purchase ?? null };
    });
  }, [q.data]);
}
