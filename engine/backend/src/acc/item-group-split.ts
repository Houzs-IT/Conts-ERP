// ----------------------------------------------------------------------------
// One ringgit, one product group, one account — the split a document's lines
// make before they reach the ledger (GL redesign item 2, owner 2026-09-05:
// ledger 只根据 invoice 认; docs/bugs/0829 for the sales side).
//
// The purchase invoice has posted this way since 2026-09-05: one debit per
// PRODUCT GROUP to that group's own purchase account. The sales invoice now
// posts the mirror: one credit per group to that group's own sales account —
// 2990's chart keeps SALES OF SOFA / BEDDING / DINING / … as separate leaves
// and its 500-0000 (RENTAL REVENUE) is INACTIVE, so a sale could not be
// booked at all on the old two-line rule.
//
// One home for the rule both sides share: the registry stores upper-case
// group codes and the sales panels write lower-case (one case-fold, never
// two vocabularies); a line with no group REFUSES by name and so does a
// group with no binding — the owner's own rule (挡下来提醒我去绑), because a
// figure silently landed on the wrong account is exactly the
// mis-classification the registry exists to end; and the header total is
// the LAW: per-group rounding must sum to exactly what the document posts,
// so any remainder lands on the largest group.
//
// Purchases by sub-category (renovation revenue plan Task 9, chew 30 Oct 2026):
// a purchase line that carries a product (item_code → scm.mfg_products, the
// ACTIVE row first) books to its product's sub-category purchase account, else
// its product's category group's (acc/reno-accounts resolveLineAccounts — the
// rule the renovation revenue side reads). A line with no product keeps its
// own item_group as before. The sales side is unchanged.
// ----------------------------------------------------------------------------

import { resolveLineAccounts, type LineAccountKey } from './reno-accounts';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;

export type GroupSplitLine = { item_group: string | null; line_total_sen: number | null; item_code?: string | null };
export type GroupAmount = { groupCode: string; accountCode: string; myrSen: number };
export type GroupSplitResult =
  | { ok: true; groups: GroupAmount[] }
  | { ok: false; status: 'no_lines' | 'line_ungrouped' | 'group_unbound' | 'post_failed'; reason: string };

export async function splitByItemGroup(
  sb: Db,
  p: {
    companyId: number | null;
    /** The document's number, for the refusal sentences. */
    docNo: string;
    items: GroupSplitLine[];
    /** Which binding of scm.acc_item_group_accounts to read. */
    account: 'purchase_account' | 'sales_account';
    /** The document's own currency → MYR sen, once per group (identity for MYR). */
    myrSen: (sen: number) => number;
    /** The header total in MYR sen — the figure the groups must sum to. */
    totalSen: number;
  },
): Promise<GroupSplitResult> {
  const noun = p.account === 'purchase_account' ? 'purchase' : 'sale';
  if (p.items.length === 0) {
    return { ok: false, status: 'no_lines', reason: `${p.docNo} has no lines — a ${noun} cannot be classified without them.` };
  }
  /* Purchases: each line's product, when it has one, decides its key (group / sub-category). */
  const productOf = new Map<string, LineAccountKey>();
  if (p.account === 'purchase_account') {
    const codes = [...new Set(p.items.map((it) => String(it.item_code ?? '').trim()).filter(Boolean))];
    if (codes.length > 0) {
      const { data, error } = await sb.from('mfg_products').select('code, category_group, sub_category, status')
        .eq('company_id', p.companyId).in('code', codes);
      if (error) return { ok: false, status: 'post_failed', reason: `products: ${error.message}` };
      const rows = ((data ?? []) as Array<{ code: string; category_group: string | null; sub_category: string | null; status: string | null }>)
        .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'));
      for (const r of rows) {
        const group = String(r.category_group ?? '').trim().toUpperCase();
        if (!productOf.has(r.code) && group) {
          productOf.set(r.code, { group, subCategory: r.sub_category ? String(r.sub_category).trim().toUpperCase() : null });
        }
      }
    }
  }
  /* A line's key: "GROUP" (its own group, or its product's with no sub-category) or "GROUP / SUB". */
  const keyOf = new Map<string, LineAccountKey>();
  const foreignByGroup = new Map<string, number>();
  for (const it of p.items) {
    const prod = productOf.get(String(it.item_code ?? '').trim());
    const g = prod?.group ?? String(it.item_group ?? '').trim().toUpperCase();
    if (!g) {
      return { ok: false, status: 'line_ungrouped', reason: `${p.docNo} has a line with no product group — fix the line, then post.` };
    }
    const label = prod?.subCategory ? `${g} / ${prod.subCategory}` : g;
    if (prod?.subCategory && !keyOf.has(label)) keyOf.set(label, prod);
    foreignByGroup.set(label, (foreignByGroup.get(label) ?? 0) + Number(it.line_total_sen ?? 0));
  }
  const groupCodes = [...foreignByGroup.keys()];
  const accountOf = new Map<string, string>();
  const subKeys = groupCodes.filter((k) => keyOf.has(k));
  if (subKeys.length > 0) {
    const res = await resolveLineAccounts(sb, p.companyId as number, subKeys.map((k) => keyOf.get(k) as LineAccountKey), p.account);
    if (!res.ok) return { ok: false, status: res.status, reason: `${p.docNo}: ${res.reason}` };
    for (const k of subKeys) accountOf.set(k, res.accountOf(keyOf.get(k) as LineAccountKey));
  }
  const plainCodes = groupCodes.filter((k) => !keyOf.has(k));
  if (plainCodes.length > 0) {
    const { data: bindsRaw, error: bindsErr } = await sb
      .from('acc_item_group_accounts')
      .select(`group_code, ${p.account}`)
      .eq('company_id', p.companyId)
      .in('group_code', plainCodes);
    if (bindsErr) return { ok: false, status: 'post_failed', reason: `group bindings: ${bindsErr.message}` };
    for (const b of (bindsRaw ?? []) as Array<Record<string, unknown>>) {
      const code = String(b[p.account] ?? '').trim();
      if (code) accountOf.set(String(b.group_code), code);
    }
  }
  const unbound = plainCodes.filter((g) => !accountOf.get(g));
  if (unbound.length > 0) {
    return {
      ok: false,
      status: 'group_unbound',
      reason: `${unbound.join(', ')} ${unbound.length === 1 ? 'is' : 'are'} not bound to a ${p.account === 'purchase_account' ? 'purchase' : 'sales'} account for this company — bind ${unbound.length === 1 ? 'it' : 'them'} on Accounting → Item Groups, then post again.`,
    };
  }
  const groups: GroupAmount[] = groupCodes.map((g) => ({
    groupCode: g,
    accountCode: accountOf.get(g) as string,
    myrSen: p.myrSen(foreignByGroup.get(g) ?? 0),
  }));
  const drift = p.totalSen - groups.reduce((s, g) => s + g.myrSen, 0);
  if (drift !== 0) {
    const biggest = groups.reduce((a, b) => (b.myrSen > a.myrSen ? b : a));
    biggest.myrSen += drift;
  }
  return { ok: true, groups };
}
