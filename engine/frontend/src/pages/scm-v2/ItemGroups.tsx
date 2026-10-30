// ----------------------------------------------------------------------------
// Item Groups tab — the product-group ↔ ledger-account registry the posting
// rules read (GL redesign item 1, owner 2026-09-05).
//
// One row per group × four account slots, for the ACTIVE company. A group the
// company has not bound yet shows the SUGGESTED defaults pre-filled and marked
// 建议 — nothing is written until the owner presses Save: 他要求"绑定表先给我
// 过目,我改完确认才生效", and this screen IS that sign-off, row by row.
//
// New groups are born HERE and born BOUND (create refuses without all four
// accounts) — the server extends the category enums in the same breath, so a
// group created here is immediately pickable on a product.
// ----------------------------------------------------------------------------

import { Fragment, useMemo, useState } from 'react';
import { getActiveCompanyId } from '../../lib/activeCompany';
import { PiBackfillCard } from './PiBackfill';
import { SearchCombo, type ComboOption } from '../../vendor/scm/components/SearchCombo';
import { useAccountRoles, useAccounts } from '../../vendor/scm/lib/accounting-queries';
import {
  useItemGroups, useCreateItemGroup, useBindItemGroup, usePatchItemGroup, useBindSubCategory,
  type ItemGroupBinding, type ItemSubCategory, type SubCategoryBinding,
} from './accounting-phase1-queries';

/* Each slot names the side of the ledger it may bind to — the purchase slots
   take EXPENSE accounts, the sales slots INCOME. The picker filters on this,
   so CAPITAL and the bank rows never crowd the list (owner 2026-09-05). */
const SLOTS: Array<{ key: keyof ItemGroupBinding; label: string; wants: 'EXPENSE' | 'INCOME' }> = [
  { key: 'purchase', label: 'Purchase', wants: 'EXPENSE' },
  { key: 'sales', label: 'Sales', wants: 'INCOME' },
  { key: 'salesReturn', label: 'Sales Return', wants: 'INCOME' },
  { key: 'purchaseReturn', label: 'Purchase Return', wants: 'EXPENSE' },
];

/** Which accounts one binding may pick: its ledger side, active. Conts (finance phase 1, spec 3.4; SOP 4.2.1 method B):
    renovation billing books to the advance — a liability — until the work is done, so RENOVATION's sales and
    sales-return slots offer liability accounts as well. */
export type BindingColumn = 'sales_account' | 'sales_return_account' | 'purchase_account' | 'purchase_return_account';
const isSalesColumn = (column: BindingColumn): boolean => column === 'sales_account' || column === 'sales_return_account';
/** Whether this binding may point at the advance (a liability): RENOVATION's sales side only. */
export const offersAdvance = (group: string, column: BindingColumn): boolean =>
  isSalesColumn(column) && group.trim().toUpperCase() === 'RENOVATION';
/** `controls`: the AR / AP control accounts (from the posting rules) — the advance is never one of them, nor a header. */
export function accountsForBinding<A extends { account_code: string; account_type: string; is_active?: boolean | null; parent_code?: string | null }>(
  group: string, column: BindingColumn, accounts: readonly A[], controls: ReadonlySet<string> = new Set(),
): A[] {
  const side = isSalesColumn(column) ? 'INCOME' : 'EXPENSE';
  const advance = offersAdvance(group, column);
  const parents = new Set(accounts.map((a) => a.parent_code).filter(Boolean));
  const advanceOk = (a: A) => advance && a.account_type === 'LIABILITY' && !controls.has(a.account_code) && !parents.has(a.account_code);
  return accounts.filter((a) => a.is_active !== false && (a.account_type === side || advanceOk(a)));
}
/** Which accounts a sub-category's own binding may pick (renovation revenue, spec 2.4): its ledger side, active, and
    never a parent account — posting refuses one, so it is never offered. */
export function accountsForSubCategory<A extends { account_code: string; account_type: string; is_active?: boolean | null; parent_code?: string | null }>(
  column: 'sales_account' | 'purchase_account', accounts: readonly A[], controls: ReadonlySet<string> = new Set(),
): A[] {
  const side = column === 'sales_account' ? 'INCOME' : 'EXPENSE';
  const parents = new Set(accounts.map((a) => a.parent_code).filter(Boolean));
  /* The server's rules (verifyAccounts): active, not a header, not a control account. */
  return accounts.filter((a) => a.is_active !== false && a.account_type === side
    && !parents.has(a.account_code) && !controls.has(a.account_code));
}
const COLUMN_OF: Record<keyof ItemGroupBinding, BindingColumn> = {
  purchase: 'purchase_account', sales: 'sales_account', salesReturn: 'sales_return_account', purchaseReturn: 'purchase_return_account',
};

/* The picker's section headers are the CHART's sections (owner 2026-09-05:
   不能这样做一个header 分类吗; 2026-09-06: stored on the account, his to move
   by dragging on the chart page) — read off each account row, ordered by
   the vocabulary the same API hands down. Nothing here decides a section. */
const UNSHELVED = 'Unsectioned';

/* The defaults the owner approved in outline (2026-09-05): sofa/bedding/dining
   purchases into their 601 children, bedlines into 602; furniture sales into
   501, bedlines & accessories into 502; returns into 510 / 612. SUGGESTIONS
   ONLY — they sit unsaved in the form until he presses Save. */
export const SUGGESTED: Record<string, ItemGroupBinding> = {
  SOFA:      { purchase: '601-0003', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  BEDFRAME:  { purchase: '601-0001', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  MATTRESS:  { purchase: '601-0001', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  DINING:    { purchase: '601-0002', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  BEDLINES:  { purchase: '602-0000', sales: '502-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  ACCESSORY: { purchase: '601-0004', sales: '502-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  DIFFUSER:  { purchase: '601-0004', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  CARPET:    { purchase: '601-0004', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  SERVICE:   { purchase: '601-0004', sales: '501-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
  /* Sofa Accessory (2026-09-14): still an accessory in the books — same accounts as ACCESSORY. */
  FABRIC_ACCESSORY: { purchase: '601-0004', sales: '502-0000', salesReturn: '510-0000', purchaseReturn: '612-0000' },
};

const EMPTY: ItemGroupBinding = { purchase: '', sales: '', salesReturn: '', purchaseReturn: '' };

/* Index reads through here so a missing key TYPES as undefined — the compiler
   has noUncheckedIndexedAccess off, and "absent binding" is this screen's
   whole subject matter. */
const pick = <T,>(rec: Record<string, T>, key: string): T | undefined => rec[key];

const cardStyle: React.CSSProperties = {
  padding: 'var(--space-4)',
  background: 'var(--c-cream)',
  border: '1px solid var(--c-line, rgba(34,31,32,0.12))',
  borderRadius: 'var(--radius-md)',
};
const btnStyle = (primary?: boolean, disabled?: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  border: '1px solid var(--c-line, rgba(34,31,32,0.2))',
  borderRadius: 'var(--radius-sm, 6px)',
  background: primary ? 'var(--c-ink)' : 'transparent',
  color: primary ? 'var(--c-cream)' : 'var(--c-ink)',
  fontSize: 'var(--fs-13)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});
const fieldStyle: React.CSSProperties = {
  padding: '5px 8px',
  border: '1px solid var(--c-line, rgba(34,31,32,0.2))',
  borderRadius: 'var(--radius-sm, 6px)',
  fontSize: 'var(--fs-13)',
  background: 'white',
};
const softText: React.CSSProperties = { fontSize: 'var(--fs-13)', color: 'var(--text-soft, #8a8578)' };
const linkBtnStyle: React.CSSProperties = {
  display: 'block', padding: 0, border: 'none', background: 'transparent',
  color: 'var(--c-ink)', textDecoration: 'underline', fontSize: 'var(--fs-13)', cursor: 'pointer',
};

export const ItemGroupsTab = () => {
  const groupsQ = useItemGroups();
  const accountsQ = useAccounts();
  const create = useCreateItemGroup();
  const bind = useBindItemGroup();
  const patchGroup = usePatchItemGroup();
  const bindSub = useBindSubCategory();

  const companies = groupsQ.data?.companies ?? [];
  const activeCo = getActiveCompanyId() ?? companies.at(0)?.id ?? null;
  const coKey = activeCo == null ? '' : String(activeCo);

  /* One option list per ledger side, sectioned the AutoCount way: a purchase
     slot sees only EXPENSE accounts (Cost of goods sold first, then
     Expenses), a sales slot only INCOME (Sales / Sales adjustments / Other
     incomes). 397 accounts collapse to the relevant page. */
  /* The control accounts (AR / AP and the other debtors / creditors) — never a renovation advance (the server refuses them too). */
  const rolesQ = useAccountRoles();
  const controls = useMemo(() => {
    const r = rolesQ.data?.roles as Record<string, string> | undefined;
    return new Set(r ? [r.AR, r.AR_OTHER, r.AP, r.AP_OTHER].filter(Boolean) : []);
  }, [rolesQ.data]);
  const optionsByWants = useMemo(() => {
    const order = (accountsQ.data?.sections ?? []).map((s) => s.section);
    const rank = (section: string): number => {
      const i = order.indexOf(section);
      return i < 0 ? order.length : i;
    };
    const toOptions = (list: Array<{ account_code: string; account_name: string; section?: string | null }>): ComboOption[] => list
      .map((a) => ({
        value: a.account_code,
        label: `${a.account_code} — ${a.account_name}`,
        group: a.section ?? UNSHELVED,
      }))
      .sort((x, y) => (rank(x.group) - rank(y.group)) || x.value.localeCompare(y.value));
    const all = accountsQ.data?.accounts ?? [];
    const build = (group: string, column: BindingColumn): ComboOption[] => toOptions(accountsForBinding(group, column, all, controls));
    return {
      /* A sub-category's own sales / purchase account: its side only, never a parent. */
      SUB_SALES: toOptions(accountsForSubCategory('sales_account', all, controls)),
      SUB_PURCHASE: toOptions(accountsForSubCategory('purchase_account', all, controls)),
      EXPENSE: build('', 'purchase_account'), INCOME: build('', 'sales_account'),
      /* RENOVATION's sales side: income and liability accounts (the advance). */
      RENOVATION_SALES: build('RENOVATION', 'sales_account'),
    };
  }, [accountsQ.data, controls]);
  const optionsFor = (group: string, slot: (typeof SLOTS)[number]): ComboOption[] =>
    (offersAdvance(group, COLUMN_OF[slot.key]) ? optionsByWants.RENOVATION_SALES : optionsByWants[slot.wants]);

  /* Unsaved edits per group. A group with no saved binding starts from the
     SUGGESTED defaults (marked as such) — the sign-off flow. */
  const [drafts, setDrafts] = useState<Record<string, ItemGroupBinding>>({});
  const [showNew, setShowNew] = useState(false);
  /* Which groups have their sub-category list open. */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const subsByGroup = useMemo(() => {
    const m = new Map<string, ItemSubCategory[]>();
    for (const s of groupsQ.data?.subCategories ?? []) m.set(s.groupCode, [...(m.get(s.groupCode) ?? []), s]);
    return m;
  }, [groupsQ.data]);
  const toggleGroup = (code: string) => setOpenGroups((cur) => {
    const next = new Set(cur);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  if (groupsQ.isLoading) return <div style={softText}>Loading…</div>;
  if (groupsQ.isError || !groupsQ.data) return <div style={softText}>Item groups did not load. Refresh to retry.</div>;
  if (activeCo == null) return <div style={softText}>No company grants resolve for this session.</div>;

  const rows = groupsQ.data.groups;

  const draftOf = (code: string, saved: ItemGroupBinding | undefined): ItemGroupBinding =>
    pick(drafts, code) ?? saved ?? pick(SUGGESTED, code) ?? EMPTY;

  const setSlot = (code: string, saved: ItemGroupBinding | undefined, key: keyof ItemGroupBinding, value: string) => {
    setDrafts((d) => ({ ...d, [code]: { ...draftOf(code, saved), [key]: value } }));
  };

  const complete = (b: ItemGroupBinding) => SLOTS.every((s) => b[s.key].trim() !== '');
  const differs = (a: ItemGroupBinding, b: ItemGroupBinding | undefined) =>
    !b || SLOTS.some((s) => a[s.key] !== b[s.key]);

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={softText}>
          Binding for company <b>{companies.find((co) => co.id === activeCo)?.code ?? activeCo}</b> — a group must be
          bound here before its purchases can post. 灰字 = 建议,按 Save 才生效.
        </div>
        <button type="button" style={btnStyle(true)} onClick={() => setShowNew(true)}>New group</button>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Group</th>
              {SLOTS.map((s) => <th key={s.key} style={{ textAlign: 'left', padding: '8px 10px', minWidth: 180 }}>{s.label}</th>)}
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Status</th>
              <th style={{ padding: '8px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const saved = pick(g.bindings, coKey);
              const draft = draftOf(g.code, saved);
              const dirty = differs(draft, saved);
              const suggested = !saved && pick(drafts, g.code) === undefined && pick(SUGGESTED, g.code) !== undefined;
              const subs = subsByGroup.get(g.code) ?? [];
              const open = openGroups.has(g.code);
              return (
                <Fragment key={g.code}>
                <tr style={{ borderTop: '1px solid var(--border-weak, #e3e1da)', opacity: g.isActive ? 1 : 0.55 }}>
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                    <b>{g.code}</b>
                    <div style={softText}>{g.name}{!g.isActive && ' · off'}</div>
                    {subs.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleGroup(g.code)}
                        style={{ ...linkBtnStyle, marginTop: 2 }}
                      >
                        {`Sub-categories (${subs.length})`}
                      </button>
                    )}
                  </td>
                  {SLOTS.map((s) => (
                    <td key={s.key} style={{ padding: '6px 10px' }}>
                      <SearchCombo
                        options={optionsFor(g.code, s)}
                        value={draft[s.key]}
                        onChange={(v) => setSlot(g.code, saved, s.key, v)}
                        aria-label={`${g.code} ${s.label} account`}
                        placeholder="— pick account —"
                      />
                    </td>
                  ))}
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                    {saved && !dirty && <span style={{ color: 'var(--c-good, #2f5d4f)' }}>bound</span>}
                    {suggested && <span style={softText}>建议 · unsaved</span>}
                    {!saved && !suggested && !complete(draft) && <span style={{ color: 'var(--c-danger, #a33)' }}>unbound</span>}
                    {dirty && !suggested && (saved || complete(draft)) && <span style={softText}>edited · unsaved</span>}
                  </td>
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      style={btnStyle(true, !complete(draft) || !dirty || bind.isPending)}
                      disabled={!complete(draft) || !dirty || bind.isPending}
                      onClick={() => bind.mutate(
                        { code: g.code, companyId: activeCo, accounts: draft },
                        { onSuccess: () => setDrafts((d) => { const { [g.code]: _gone, ...rest } = d; return rest; }) },
                      )}
                    >
                      Save
                    </button>{' '}
                    <button
                      type="button"
                      style={btnStyle(false, patchGroup.isPending)}
                      disabled={patchGroup.isPending}
                      title={g.isActive ? 'Hide from new products (bindings stay)' : 'Offer to new products again'}
                      onClick={() => patchGroup.mutate({ code: g.code, isActive: !g.isActive })}
                    >
                      {g.isActive ? 'Turn off' : 'Turn on'}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={SLOTS.length + 3} style={{ padding: '0 10px 10px 28px' }}>
                      <SubCategoryTable
                        subs={subs}
                        coKey={coKey}
                        salesOptions={optionsByWants.SUB_SALES}
                        purchaseOptions={optionsByWants.SUB_PURCHASE}
                        pending={bindSub.isPending}
                        onSave={(code, b, saved) => bindSub.mutate({ code, companyId: activeCo, ...b }, { onSuccess: saved })}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(bind.isError || create.isError || patchGroup.isError || bindSub.isError) && (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--c-danger, #a33)' }}>
          {String(((bind.error ?? create.error ?? patchGroup.error ?? bindSub.error) as { message?: string } | null)?.message ?? 'The change was not saved.')}
        </div>
      )}

      {showNew && (
        <NewGroupDialog
          optionsByWants={optionsByWants}
          pending={create.isPending}
          onClose={() => setShowNew(false)}
          onCreate={(body) => create.mutate(
            { ...body, companyId: activeCo },
            { onSuccess: () => setShowNew(false) },
          )}
        />
      )}

      {/* Bindings feed the backfill — the historical PIs repost right where
          the groups were just signed off (item 3's door, owner-pressed). */}
      <PiBackfillCard />
    </div>
  );
};

/* ── New group — born bound ──────────────────────────────────────────────── */
const NewGroupDialog = ({
  optionsByWants, pending, onClose, onCreate,
}: {
  optionsByWants: Record<'EXPENSE' | 'INCOME', ComboOption[]>;
  pending: boolean;
  onClose: () => void;
  onCreate: (body: { code: string; name: string; accounts: ItemGroupBinding }) => void;
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accounts, setAccounts] = useState<ItemGroupBinding>(EMPTY);
  const codeOk = /^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(code.trim());
  const ready = codeOk && name.trim() !== '' && SLOTS.every((s) => accounts[s.key].trim() !== '');

  return (
    <div role="presentation" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div role="dialog" aria-label="New item group" style={{ ...cardStyle, background: 'var(--c-paper, #fff)', width: 'min(440px, 92vw)' }}>
        <div className="space-y-2">
          <b>New group</b>
          <div style={softText}>四个 account 都绑了才能 create — 没绑的 group 不给过账。</div>
          <input style={{ ...fieldStyle, width: '100%' }} placeholder="Code (e.g. CURTAIN)" value={code}
            aria-label="Group code" onChange={(e) => setCode(e.target.value)} />
          <input style={{ ...fieldStyle, width: '100%' }} placeholder="Name" value={name}
            aria-label="Group name" onChange={(e) => setName(e.target.value)} />
          {SLOTS.map((s) => (
            <div key={s.key}>
              <div style={softText}>{s.label}</div>
              <SearchCombo options={optionsByWants[s.wants]} value={accounts[s.key]}
                onChange={(v) => setAccounts((a) => ({ ...a, [s.key]: v }))}
                aria-label={`New group ${s.label} account`} placeholder="— pick account —" />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button type="button" style={btnStyle(false)} onClick={onClose}>Cancel</button>
            <button type="button" style={btnStyle(true, !ready || pending)} disabled={!ready || pending}
              onClick={() => onCreate({ code: code.trim().toUpperCase(), name: name.trim(), accounts })}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── A group's sub-categories — each may carry its own sales / purchase account ──
   Renovation revenue (spec 2.4): a renovation line books to its sub-category's account, else its group's. An empty
   picker means "uses the group's account"; Save writes this company's two sides, Use group clears both. */
const SubCategoryTable = ({
  subs, coKey, salesOptions, purchaseOptions, pending, onSave,
}: {
  subs: ItemSubCategory[];
  coKey: string;
  salesOptions: ComboOption[];
  purchaseOptions: ComboOption[];
  pending: boolean;
  /** `saved` runs once the server accepts — only then is the draft dropped, so a refused save keeps the picks. */
  onSave: (code: string, binding: SubCategoryBinding, saved: () => void) => void;
}) => {
  type Draft = { sales: string; purchase: string };
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const savedOf = (s: ItemSubCategory): Draft => {
    const b = pick(s.bindings, coKey);
    return { sales: b?.salesAccount ?? '', purchase: b?.purchaseAccount ?? '' };
  };
  const draftOf = (s: ItemSubCategory): Draft => pick(drafts, s.code) ?? savedOf(s);
  const setSide = (s: ItemSubCategory, side: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [s.code]: { ...draftOf(s), [side]: value } }));
  const forget = (code: string) => setDrafts((d) => { const { [code]: _gone, ...rest } = d; return rest; });
  const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-13)' }}>
      <thead>
        <tr style={softText}>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>Sub-category</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, minWidth: 180 }}>Sales</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, minWidth: 180 }}>Purchase</th>
          <th style={{ padding: '4px 8px' }} />
        </tr>
      </thead>
      <tbody>
        {subs.map((s) => {
          const saved = savedOf(s);
          const draft = draftOf(s);
          const dirty = draft.sales !== saved.sales || draft.purchase !== saved.purchase;
          const hasOwn = saved.sales !== '' || saved.purchase !== '';
          return (
            <tr key={s.code} style={{ borderTop: '1px solid var(--border-weak, #e3e1da)' }}>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                {s.label}
                <div style={softText}>{s.code}</div>
              </td>
              <td style={{ padding: '4px 8px' }}>
                <SearchCombo options={salesOptions} value={draft.sales} onChange={(v) => setSide(s, 'sales', v)}
                  aria-label={`${s.code} Sales account`} placeholder="Uses the group's account" />
              </td>
              <td style={{ padding: '4px 8px' }}>
                <SearchCombo options={purchaseOptions} value={draft.purchase} onChange={(v) => setSide(s, 'purchase', v)}
                  aria-label={`${s.code} Purchase account`} placeholder="Uses the group's account" />
              </td>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                <button type="button" style={btnStyle(true, !dirty || pending)} disabled={!dirty || pending}
                  onClick={() => onSave(s.code, { salesAccount: orNull(draft.sales), purchaseAccount: orNull(draft.purchase) }, () => forget(s.code))}>
                  Save
                </button>{' '}
                <button type="button" style={btnStyle(false, !hasOwn || pending)} disabled={!hasOwn || pending}
                  title="Clear both sides — the group's accounts apply"
                  onClick={() => onSave(s.code, { salesAccount: null, purchaseAccount: null }, () => forget(s.code))}>
                  Use group
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
