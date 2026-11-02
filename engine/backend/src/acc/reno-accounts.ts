// ----------------------------------------------------------------------------
// Which account a renovation line books to (spec 2.4, plan Task 1).
//
// A line carries its product's category group and sub-category. Its account is the sub-category's own binding
// (scm.acc_sub_category_accounts) when that side is set, else the group's (scm.acc_item_group_accounts). A line with
// neither REFUSES by name — the same rule as the item-group split's group_unbound: a figure silently landed on a
// default account is exactly what the registry exists to stop.
// ----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;

export type LineAccountKey = { group: string; subCategory: string | null };
export type LineAccountSide = 'sales_account' | 'purchase_account';
export type LineAccountsResult =
  | { ok: true; accountOf: (k: LineAccountKey) => string }
  | { ok: false; status: 'group_unbound' | 'post_failed'; reason: string };

const norm = (v: string | null | undefined): string => String(v ?? '').trim().toUpperCase();

export async function resolveLineAccounts(
  sb: Db,
  companyId: number,
  keys: LineAccountKey[],
  which: LineAccountSide,
): Promise<LineAccountsResult> {
  const groups = [...new Set(keys.map((k) => norm(k.group)).filter(Boolean))];
  const subs = [...new Set(keys.map((k) => norm(k.subCategory)).filter(Boolean))];

  const [groupRes, subRes] = await Promise.all([
    groups.length === 0
      ? Promise.resolve({ data: [], error: null })
      : sb.from('acc_item_group_accounts').select(`group_code, ${which}`).eq('company_id', companyId).in('group_code', groups),
    subs.length === 0
      ? Promise.resolve({ data: [], error: null })
      : sb.from('acc_sub_category_accounts').select(`sub_category_code, ${which}`).eq('company_id', companyId).in('sub_category_code', subs),
  ]);
  if (groupRes.error) return { ok: false, status: 'post_failed', reason: `group bindings: ${groupRes.error.message}` };
  if (subRes.error) return { ok: false, status: 'post_failed', reason: `sub-category bindings: ${subRes.error.message}` };

  const byGroup = new Map<string, string>();
  for (const r of (groupRes.data ?? []) as Array<Record<string, unknown>>) {
    const code = String(r[which] ?? '').trim();
    if (code) byGroup.set(norm(String(r.group_code)), code);
  }
  const bySub = new Map<string, string>();
  for (const r of (subRes.data ?? []) as Array<Record<string, unknown>>) {
    const code = String(r[which] ?? '').trim();
    if (code) bySub.set(norm(String(r.sub_category_code)), code);
  }

  const find = (k: LineAccountKey): string | undefined => {
    const sub = norm(k.subCategory);
    return (sub ? bySub.get(sub) : undefined) ?? byGroup.get(norm(k.group));
  };

  const missing = [...new Set(keys.filter((k) => !find(k)).map((k) => {
    const g = norm(k.group) || '(no group)';
    const sub = norm(k.subCategory);
    return sub ? `${g} / ${sub}` : g;
  }))];
  if (missing.length > 0) {
    const side = which === 'sales_account' ? 'sales' : 'purchase';
    return {
      ok: false,
      status: 'group_unbound',
      reason: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no ${side} account for this company — bind the sub-category or its group on Accounting → Item Groups, then post again.`,
    };
  }

  return {
    ok: true,
    accountOf: (k) => {
      const code = find(k);
      if (!code) throw new Error(`resolveLineAccounts: ${norm(k.group)} / ${norm(k.subCategory)} was not among the keys resolved`);
      return code;
    },
  };
}
