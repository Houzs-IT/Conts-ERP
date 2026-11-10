// ----------------------------------------------------------------------------
// Item Groups tab — the product-group ↔ ledger-account registry the posting
// rules read (GL redesign item 1, owner 2026-09-05).
//
// One row per group × four account slots, for the ACTIVE company. A group the
// company has not bound yet opens with the SUGGESTED defaults pre-filled and
// marked 建议 — nothing is written until the owner presses Save: 他要求"绑定表先给我
// 过目,我改完确认才生效", and the group's dialog IS that sign-off.
//
// New groups are born HERE and born BOUND (create refuses without all four
// accounts) — the server extends the category enums in the same breath, so a
// group created here is immediately pickable on a product.
//
// Conts (chew 10 Nov 2026: "做成好看的table"): the bindings read as the finance
// pages' table, every account with its full name; a group is bound in its own
// dialog, its sub-categories under it. An account with accounts under it is
// never offered: posting refuses a header (chew: 有子科目的就直接让父账户不显示).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { getActiveCompanyId } from '../../lib/activeCompany';
import { PiBackfillCard } from './PiBackfill';
import { SearchCombo, type ComboOption } from '../../vendor/scm/components/SearchCombo';
import { Modal } from '../../vendor/scm/components/Modal';
import { DataTable, type Column } from '../../components/DataTable';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { useAccountRoles, useAccounts } from '../../vendor/scm/lib/accounting-queries';
import {
  useItemGroups, useCreateItemGroup, useBindItemGroup, usePatchItemGroup, useBindSubCategory,
  type ItemGroup, type ItemGroupBinding, type ItemSubCategory, type SubCategoryBinding,
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

export type BindingColumn = 'sales_account' | 'sales_return_account' | 'purchase_account' | 'purchase_return_account';
const isSalesColumn = (column: BindingColumn): boolean => column === 'sales_account' || column === 'sales_return_account';
/** Whether this binding may point at the advance (a liability): RENOVATION's sales side only. */
export const offersAdvance = (group: string, column: BindingColumn): boolean =>
  isSalesColumn(column) && group.trim().toUpperCase() === 'RENOVATION';
/** Which accounts one binding may pick: its ledger side, active, never a control account (`controls`: the AR / AP and
    other debtor / creditor controls, from the posting rules) and never an account with accounts under it — the server
    refuses both (chew 10 Nov 2026: 有子科目的就直接让父账户不显示). Conts (finance phase 1, spec 3.4): RENOVATION's sales
    and sales-return slots offer liability accounts as well (the advance). */
export function accountsForBinding<A extends { account_code: string; account_type: string; is_active?: boolean | null; parent_code?: string | null }>(
  group: string, column: BindingColumn, accounts: readonly A[], controls: ReadonlySet<string> = new Set(),
): A[] {
  const side = isSalesColumn(column) ? 'INCOME' : 'EXPENSE';
  const advance = offersAdvance(group, column);
  const parents = new Set(accounts.map((a) => a.parent_code).filter(Boolean));
  return accounts.filter((a) => a.is_active !== false && !parents.has(a.account_code) && !controls.has(a.account_code)
    && (a.account_type === side || (advance && a.account_type === 'LIABILITY')));
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
   ONLY — they sit unsaved in the form until he presses Save. A suggestion is
   offered only when every one of its four accounts can be picked in this
   company's chart (Conts, 10 Nov 2026): on another chart the same code can mean
   something else, or nothing. */
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

const complete = (b: ItemGroupBinding | undefined): b is ItemGroupBinding => !!b && SLOTS.every((s) => b[s.key].trim() !== '');
const sameBinding = (a: ItemGroupBinding, b: ItemGroupBinding | undefined): boolean => !!b && SLOTS.every((s) => a[s.key] === b[s.key]);
const errorText = (e: unknown): string => String((e as { message?: string } | null)?.message ?? 'The change was not saved.');

type GroupStatus = 'bound' | 'unbound' | 'off';
type Mutation<V> = { mutate: (v: V, opts?: { onSuccess?: () => void }) => void; isPending: boolean; isError: boolean; error: unknown };

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
  /* The control accounts (AR / AP and the other debtors / creditors) — never offered (the server refuses them too). */
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
  const accountName = useMemo(() => new Map((accountsQ.data?.accounts ?? []).map((a) => [a.account_code, a.account_name] as const)), [accountsQ.data]);

  const subsByGroup = useMemo(() => {
    const m = new Map<string, ItemSubCategory[]>();
    for (const s of groupsQ.data?.subCategories ?? []) m.set(s.groupCode, [...(m.get(s.groupCode) ?? []), s]);
    return m;
  }, [groupsQ.data]);

  /* Which group's dialog is open (its code), and the New group dialog. */
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const savedOf = (g: ItemGroup): ItemGroupBinding | undefined => pick(g.bindings, coKey);
  const statusOf = (g: ItemGroup): GroupStatus => (!g.isActive ? 'off' : complete(savedOf(g)) ? 'bound' : 'unbound');
  /** The suggested defaults for an unbound group — only when every one of them can be picked here. */
  const suggestionFor = (code: string): ItemGroupBinding | undefined => {
    const s = pick(SUGGESTED, code);
    return s && SLOTS.every((slot) => optionsFor(code, slot).some((o) => o.value === s[slot.key])) ? s : undefined;
  };

  const columns: Column<ItemGroup>[] = [
    {
      key: 'group', label: 'Group', width: '190px', getValue: (g) => g.code, searchValue: (g) => `${g.code} ${g.name}`,
      render: (g) => {
        const subs = subsByGroup.get(g.code) ?? [];
        const own = subs.filter((s) => pick(s.bindings, coKey)).length;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'normal' }}>
            <span className="font-semibold text-ink">{g.code}</span>
            <span className="text-xs text-ink-muted">{g.name}</span>
            {subs.length > 0 && (
              <span className="text-xs text-ink-muted">
                {subs.length} sub-categor{subs.length === 1 ? 'y' : 'ies'}{own > 0 ? ` · ${own} with own accounts` : ''}
              </span>
            )}
          </div>
        );
      },
    },
    ...SLOTS.map((s): Column<ItemGroup> => ({
      key: s.key, label: s.label, getValue: (g) => savedOf(g)?.[s.key] ?? '',
      searchValue: (g) => { const code = savedOf(g)?.[s.key] ?? ''; return code ? `${code} ${accountName.get(code) ?? ''}` : ''; },
      render: (g) => <AccountCell code={savedOf(g)?.[s.key]} name={accountName} />,
    })),
    {
      key: 'status', label: 'Status', width: '110px', getValue: (g) => statusOf(g),
      render: (g) => <StatusBadge status={statusOf(g)} />,
    },
    {
      key: 'actions', label: '', width: '96px', disableSort: true, disableFilter: true, getValue: () => '',
      render: (g) => {
        const verb = statusOf(g) === 'unbound' ? 'Bind' : 'Edit';
        /* Quiet on purpose: ten filled buttons down a column read as a wall (chew 10 Nov 2026, the keeper list). */
        return (
          <Button variant="secondary" className="h-8 px-3" aria-label={`${verb} ${g.code}`} onClick={() => setOpenCode(g.code)}>
            {verb}
          </Button>
        );
      },
    },
  ];

  if (groupsQ.isLoading) return <div className="text-[13px] text-ink-muted">Loading…</div>;
  if (groupsQ.isError || !groupsQ.data) return <div className="text-[13px] text-ink-muted">Item groups did not load. Refresh to retry.</div>;
  if (activeCo == null) return <div className="text-[13px] text-ink-muted">No company grants resolve for this session.</div>;

  const rows = groupsQ.data.groups;
  const live = rows.filter((g) => g.isActive);
  const boundCount = live.filter((g) => statusOf(g) === 'bound').length;
  const open = openCode == null ? undefined : rows.find((g) => g.code === openCode);
  const companyCode = companies.find((co) => co.id === activeCo)?.code ?? String(activeCo);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="text-[13px] text-ink-muted" style={{ maxWidth: 760 }}>
          <span className="font-semibold text-ink" data-testid="groups-bound">{boundCount} of {live.length} groups bound</span>
          {companies.length > 1 && <> · company <b>{companyCode}</b></>}
          {' '}— a group needs all four accounts before its sales and purchases can post. Accounts that have accounts under
          them are not offered: pick one of the accounts under it.
        </div>
        <Button onClick={() => setShowNew(true)}>New group</Button>
      </div>

      <DataTable<ItemGroup>
        tableId="conts-item-group-accounts"
        columns={columns}
        rows={rows}
        getRowKey={(g) => g.code}
        emptyLabel="No item groups yet."
        getRowStyle={(g) => (g.isActive ? undefined : { opacity: 0.6 })}
      />

      {open && (
        <GroupDialog
          key={open.code}
          group={open}
          saved={savedOf(open)}
          suggestion={complete(savedOf(open)) ? undefined : suggestionFor(open.code)}
          optionsFor={optionsFor}
          subs={subsByGroup.get(open.code) ?? []}
          coKey={coKey}
          salesOptions={optionsByWants.SUB_SALES}
          purchaseOptions={optionsByWants.SUB_PURCHASE}
          bind={bind}
          patchGroup={patchGroup}
          bindSub={bindSub}
          activeCo={activeCo}
          onClose={() => setOpenCode(null)}
        />
      )}

      {showNew && (
        <NewGroupDialog
          optionsByWants={optionsByWants}
          pending={create.isPending}
          error={create.isError ? errorText(create.error) : null}
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

/** One bound account: its code, and its full name under it (names wrap, never cut). */
const AccountCell = ({ code, name }: { code: string | undefined; name: ReadonlyMap<string, string> }) => {
  if (!code) return <span className="text-ink-muted">—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'normal' }}>
      <span className="font-medium text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>{code}</span>
      <span className="text-xs text-ink-muted">{name.get(code) ?? 'Not in the chart'}</span>
    </div>
  );
};

const StatusBadge = ({ status }: { status: GroupStatus }) => {
  if (status === 'bound') return <Badge tone="success" size="sm" caseless>Bound</Badge>;
  if (status === 'off') return <Badge tone="neutral" size="sm" caseless>Off</Badge>;
  return <Badge tone="error" size="sm" caseless>Not bound</Badge>;
};

const fieldLabel = 'text-[13px] font-semibold text-ink';
const hint = 'text-[12px] text-ink-muted';

/* ── One group: its four accounts, turning it off, and its sub-categories ───── */
const GroupDialog = ({
  group, saved, suggestion, optionsFor, subs, coKey, salesOptions, purchaseOptions, bind, patchGroup, bindSub, activeCo, onClose,
}: {
  group: ItemGroup;
  saved: ItemGroupBinding | undefined;
  suggestion: ItemGroupBinding | undefined;
  optionsFor: (group: string, slot: (typeof SLOTS)[number]) => ComboOption[];
  subs: ItemSubCategory[];
  coKey: string;
  salesOptions: ComboOption[];
  purchaseOptions: ComboOption[];
  bind: Mutation<{ code: string; companyId: number; accounts: ItemGroupBinding }>;
  patchGroup: Mutation<{ code: string; isActive: boolean }>;
  bindSub: Mutation<{ code: string; companyId: number } & SubCategoryBinding>;
  activeCo: number;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState<ItemGroupBinding>(saved ?? suggestion ?? EMPTY);
  const suggested = !complete(saved) && !!suggestion && sameBinding(draft, suggestion);
  const canSave = complete(draft) && !sameBinding(draft, saved) && !bind.isPending;
  const failed = bind.isError ? bind.error : patchGroup.isError ? patchGroup.error : bindSub.isError ? bindSub.error : null;

  return (
    <Modal title={`${group.code} · ${group.name}`} onClose={onClose} width="min(920px, 100%)" ariaLabel={`${group.code} accounts`}>
      {!group.isActive && (
        <div role="note" className="rounded-md border border-border bg-surface-dim px-3 py-2 text-[13px] text-ink-muted">
          This group is off: new products cannot pick it. Its accounts still post for products that already use it.
        </div>
      )}
      {suggested && (
        <div role="note" className="rounded-md border border-warning-text/30 bg-warning-bg px-3 py-2 text-[13px] text-warning-text">
          Suggested accounts — nothing is saved yet. Check them, then press Save.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {SLOTS.map((s) => (
          <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={fieldLabel}>{s.label}</span>
            <SearchCombo fill options={optionsFor(group.code, s)} value={draft[s.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
              aria-label={`${group.code} ${s.label} account`} placeholder="Type a code or a name…" />
          </div>
        ))}
      </div>
      {failed != null && <div role="alert" className="text-[13px] text-err">{errorText(failed)}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" className="h-8 px-3" disabled={patchGroup.isPending}
          title={group.isActive ? 'Hide from new products (bindings stay)' : 'Offer to new products again'}
          onClick={() => patchGroup.mutate({ code: group.code, isActive: !group.isActive })}>
          {group.isActive ? 'Turn off' : 'Turn on'}
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" className="h-8 px-3" onClick={onClose}>Close</Button>
          <Button className="h-8 px-3" disabled={!canSave}
            onClick={() => bind.mutate({ code: group.code, companyId: activeCo, accounts: draft }, { onSuccess: onClose })}>
            Save
          </Button>
        </div>
      </div>
      {subs.length > 0 && (
        <section aria-label="Sub-categories" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div>
            <h3 className="text-[14px] font-semibold text-ink" style={{ margin: 0 }}>Sub-categories ({subs.length})</h3>
            <p className={hint} style={{ margin: '2px 0 0' }}>
              A renovation line books to its sub-category&apos;s own account; an empty side uses the group&apos;s account above.
            </p>
          </div>
          <SubCategoryTable
            subs={subs}
            coKey={coKey}
            salesOptions={salesOptions}
            purchaseOptions={purchaseOptions}
            pending={bindSub.isPending}
            onSave={(code, b, done) => bindSub.mutate({ code, companyId: activeCo, ...b }, { onSuccess: done })}
          />
        </section>
      )}
    </Modal>
  );
};

/* ── New group — born bound ──────────────────────────────────────────────── */
const NewGroupDialog = ({
  optionsByWants, pending, error, onClose, onCreate,
}: {
  optionsByWants: Record<'EXPENSE' | 'INCOME', ComboOption[]>;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (body: { code: string; name: string; accounts: ItemGroupBinding }) => void;
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accounts, setAccounts] = useState<ItemGroupBinding>(EMPTY);
  const codeOk = /^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(code.trim());
  const ready = codeOk && name.trim() !== '' && SLOTS.every((s) => accounts[s.key].trim() !== '');
  const input = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink';

  return (
    <Modal title="New group" onClose={onClose} width="min(760px, 100%)" ariaLabel="New item group">
      <p className={hint} style={{ margin: 0 }}>All four accounts must be bound before you can create it — a group without them cannot post.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={fieldLabel}>Code</span>
          <input className={input} placeholder="e.g. CURTAIN" value={code} aria-label="Group code" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={fieldLabel}>Name</span>
          <input className={input} placeholder="e.g. Curtains" value={name} aria-label="Group name" onChange={(e) => setName(e.target.value)} />
        </div>
        {SLOTS.map((s) => (
          <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={fieldLabel}>{s.label}</span>
            <SearchCombo fill options={optionsByWants[s.wants]} value={accounts[s.key]}
              onChange={(v) => setAccounts((a) => ({ ...a, [s.key]: v }))}
              aria-label={`New group ${s.label} account`} placeholder="Type a code or a name…" />
          </div>
        ))}
      </div>
      {error && <div role="alert" className="text-[13px] text-err">{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" className="h-8 px-3" onClick={onClose}>Cancel</Button>
        <Button className="h-8 px-3" disabled={!ready || pending}
          onClick={() => onCreate({ code: code.trim().toUpperCase(), name: name.trim(), accounts })}>
          Create
        </Button>
      </div>
    </Modal>
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
  const th = 'px-2 py-1.5 text-left text-[12px] font-medium text-ink-muted';

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-13)' }}>
        <thead>
          <tr>
            <th className={th}>Sub-category</th>
            <th className={th} style={{ minWidth: 200 }}>Sales</th>
            <th className={th} style={{ minWidth: 200 }}>Purchase</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => {
            const saved = savedOf(s);
            const draft = draftOf(s);
            const dirty = draft.sales !== saved.sales || draft.purchase !== saved.purchase;
            const hasOwn = saved.sales !== '' || saved.purchase !== '';
            return (
              <tr key={s.code} style={{ borderTop: '1px solid var(--line)' }}>
                <td className="px-2 py-1.5" style={{ whiteSpace: 'nowrap' }}>
                  <span className="text-ink">{s.label}</span>
                  <div className={hint}>{s.code}</div>
                </td>
                <td className="px-2 py-1.5">
                  <SearchCombo fill options={salesOptions} value={draft.sales} onChange={(v) => setSide(s, 'sales', v)}
                    aria-label={`${s.code} Sales account`} placeholder="Uses the group's account" />
                </td>
                <td className="px-2 py-1.5">
                  <SearchCombo fill options={purchaseOptions} value={draft.purchase} onChange={(v) => setSide(s, 'purchase', v)}
                    aria-label={`${s.code} Purchase account`} placeholder="Uses the group's account" />
                </td>
                <td className="px-2 py-1.5" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <Button variant={dirty ? 'primary' : 'secondary'} className="h-8 px-3" disabled={!dirty || pending}
                    onClick={() => onSave(s.code, { salesAccount: orNull(draft.sales), purchaseAccount: orNull(draft.purchase) }, () => forget(s.code))}>
                    Save
                  </Button>{' '}
                  <Button variant="ghost" className="h-8 px-3" disabled={!hasOwn || pending}
                    title="Clear both sides — the group's accounts apply"
                    onClick={() => onSave(s.code, { salesAccount: null, purchaseAccount: null }, () => forget(s.code))}>
                    Use group
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
