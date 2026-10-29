// Conts only (not part of Houzs's code): is the ledger ready to go live? (finance phase 1, spec 3.4; gaps G8, G9.)
//
// Every automatic posting reads a rule (scm.acc_account_roles, with the AutoCount codes as the fallback) or an item
// group's binding (scm.acc_item_group_accounts); a payment voucher's number needs its bank's letter; and nothing posts
// the right way until the books have a start date. One answer for the Ledger setup page: what is wrong, by name.
import { DEFAULT_ROLE_CODES, resolveRoles, type AccountRole } from "../acc/rules";
import { loadLedgerSettings } from "../acc/ledger-settings";
import { isClearingCode } from "../scm/routes/accounting-settlement";

type Db = Parameters<typeof loadLedgerSettings>[0];

/** What kind of account a rule must point at. Money: the cash drawer and the default bank. Clearing: the card machine
    and the online payments — the 326- / 327- accounts the settlement layer owns, which are NOT money (the settlement
    setup refuses money there, and Daily Bank shows them beside the banks). Any: every other rule. */
export type RoleKind = "money" | "clearing" | "any";
export const roleKind = (role: AccountRole): RoleKind =>
  role === "CASH" || role === "BANK_DEFAULT" ? "money" : role === "TRANSIT_EDC" || role === "TRANSIT_ONLINE" ? "clearing" : "any";

/** Rules nothing posts on any more, so they are not part of being ready: SALES was the template's (sales post by item
    group), INVENTORY and CLOSING_STOCK the one-account stock the three stock buckets replaced (2026-09-21), PETTY_CASH
    the one petty cash account each float's own account replaced (Conts, chew 29 Oct 2026), and AR: every customer posts
    to its own account, and one without is never guessed onto a default (Conts, chew 29 Oct 2026). */
export const RETIRED_ROLES: readonly AccountRole[] = ["SALES", "INVENTORY", "CLOSING_STOCK", "PETTY_CASH", "AR"];

/** Rules whose account holds open balances — what customers and suppliers owe, money waiting in a clearing, deposits,
    stock. Moving one leaves those balances on the old account while new postings go to the new one, so the move is
    confirmed first. The default bank and the drawer are not here: each bank keeps its own money, and moving the
    default only changes where new vouchers start. */
export const OPEN_BALANCE_ROLES: readonly AccountRole[] = [
  "AR", "AR_OTHER", "AP", "AP_OTHER", "TRANSIT_EDC", "TRANSIT_ONLINE", "CUSTOMER_DEPOSITS",
  "INVENTORY_CUSTOMER", "INVENTORY_DISPLAY", "INVENTORY_SERVICE",
];

export const BINDING_COLUMNS = ["sales_account", "sales_return_account", "purchase_account", "purchase_return_account"] as const;
export type BindingColumn = (typeof BINDING_COLUMNS)[number];

export type RoleProblem = "missing_account" | "inactive" | "header" | "not_money" | "not_clearing";

export interface LedgerSetupStatus {
  ready: boolean;
  roles: { role: string; accountCode: string; kind: RoleKind; problem: null | RoleProblem }[];
  itemGroups: { group: string; missing: BindingColumn[] }[];
  banksWithoutLetter: string[];
  /** Customer or supplier controls (SDC / SCC) with sub-accounts under them: they cannot be posted to (Conts). */
  controlsWithChildren: string[];
  ledgerStartDate: string | null;
}

type ChartRow = { account_code: string; is_active: boolean | null; acc_money: boolean | null; parent_code: string | null; special_type?: string | null };

/** What a rule's account must be: in the chart, active, not a header (posting refuses one), and of the rule's kind.
    Null when it is fine. Shared by the status and by PUT /roles/:role. */
export function roleProblem(role: AccountRole, code: string, chart: readonly ChartRow[]): RoleProblem | null {
  const acc = chart.find((a) => a.account_code === code);
  if (!acc) return "missing_account";
  if (acc.is_active !== true) return "inactive";
  if (chart.some((a) => a.parent_code === code)) return "header";
  const kind = roleKind(role);
  if (kind === "money" && acc.acc_money !== true) return "not_money";
  if (kind === "clearing" && (acc.acc_money === true || !isClearingCode(code))) return "not_clearing";
  return null;
}

export async function ledgerSetupStatus(sb: Db, companyId: number): Promise<LedgerSetupStatus> {
  const [roles, chartRes, groupsRes, bindsRes, lettersRes, settings, floatsRes] = await Promise.all([
    resolveRoles(sb, companyId),
    sb.from("accounts").select("account_code, is_active, acc_money, parent_code, special_type").eq("company_id", companyId),
    sb.from("acc_item_groups").select("code, is_active").order("code"),
    sb.from("acc_item_group_accounts").select(`group_code, ${BINDING_COLUMNS.join(", ")}`).eq("company_id", companyId),
    sb.from("acc_bank_letters").select("account_code, letter").eq("company_id", companyId),
    loadLedgerSettings(sb, companyId),
    sb.from("petty_cash_floats").select("account_code").eq("company_id", companyId),
  ]);
  for (const r of [chartRes, groupsRes, bindsRes, lettersRes, floatsRes]) if (r.error) throw new Error(r.error.message);
  if (!settings.ok) throw new Error("The ledger settings could not be read.");
  const chart = (chartRes.data ?? []) as ChartRow[];

  const roleRows = (Object.keys(DEFAULT_ROLE_CODES) as AccountRole[])
    .filter((role) => !RETIRED_ROLES.includes(role))
    .map((role) => ({
      role, accountCode: roles[role], kind: roleKind(role), problem: roleProblem(role, roles[role], chart),
    }));

  const binds = new Map(((bindsRes.data ?? []) as Array<Record<string, unknown>>).map((b) => [String(b.group_code), b]));
  const itemGroups = ((groupsRes.data ?? []) as Array<{ code: string; is_active: boolean | null }>)
    .filter((g) => g.is_active !== false)
    .map((g) => ({ group: g.code, missing: BINDING_COLUMNS.filter((col) => !String(binds.get(g.code)?.[col] ?? "").trim()) }))
    .filter((g) => g.missing.length > 0);

  // The cash drawer mints on its fixed letter (payment-vouchers.ts mintFormalPvNo); every other money account needs one,
  // except a petty cash float's own account, open or closed (Conts): nothing pays a voucher out of it.
  const floatAccounts = new Set(((floatsRes.data ?? []) as Array<{ account_code: string | null }>).map((f) => f.account_code).filter(Boolean));
  const lettered = new Set(((lettersRes.data ?? []) as Array<{ account_code: string; letter: string | null }>)
    .filter((l) => String(l.letter ?? "").trim()).map((l) => l.account_code));
  const banksWithoutLetter = chart
    .filter((a) => a.acc_money === true && a.is_active === true && a.account_code !== roles.CASH && !floatAccounts.has(a.account_code) && !lettered.has(a.account_code))
    .map((a) => a.account_code).sort();

  /* Conts: a customer or supplier control is posted to directly; one with sub-accounts would refuse every posting. */
  const parents = new Set(chart.map((a) => a.parent_code).filter(Boolean));
  const controlsWithChildren = chart
    .filter((a) => (a.special_type === "SDC" || a.special_type === "SCC") && parents.has(a.account_code))
    .map((a) => a.account_code).sort();

  const ledgerStartDate = settings.settings.ledgerStartDate;
  return {
    ready: roleRows.every((r) => !r.problem) && itemGroups.length === 0 && banksWithoutLetter.length === 0
      && controlsWithChildren.length === 0 && ledgerStartDate != null,
    roles: roleRows, itemGroups, banksWithoutLetter, controlsWithChildren, ledgerStartDate,
  };
}
