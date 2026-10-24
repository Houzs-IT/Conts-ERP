// Conts only (not part of Houzs's code): customers and suppliers under their control (finance phase 1.5, spec
// docs/superpowers/specs/2026-10-23-finance-debtors-contracts-design.md section 2; SOP 2.1). AutoCount keeps each
// customer (SDR) and supplier (SCR) as a sub-account of its control; here the control is the only account, the
// customer is a row of scm.debtors and the supplier a row of scm.suppliers, each naming its control.
import { paginateAll } from '../scm/lib/paginate-all';
import { apControlOf, DEFAULT_ROLE_CODES, resolveRoles, type RoleCodes } from '../acc/rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

/** A customer or supplier sub-account read off AutoCount's chart (the frontend's parseChartXlsx). */
export type ParsedParty = { code: string; name: string; controlCode: string; kind: 'DEBTOR' | 'CREDITOR' };
export type PartyImportResult = {
  /** New customers and new suppliers written. */
  debtors: number;
  creditors: number;
  /** ERP suppliers that took their AutoCount code. */
  renamed: number;
  /** Rows already there, left as finance keeps them (only an empty control is filled). */
  kept: number;
  errors: { code: string; error: string }[];
};
type SupplierRow = { id: string; company_id: number; code: string; name: string; control_account: string | null };

/* Rows per insert: each call is one of the Worker's limited subrequests. */
const CHUNK = 200;

async function supplierRows(sb: Db, companyId: number): Promise<{ ok: true; rows: SupplierRow[] } | { ok: false; error: string }> {
  const { data, error } = await paginateAll((from, to) => sb.from('suppliers')
    .select('id, company_id, code, name, control_account').eq('company_id', companyId).order('id').range(from, to));
  if (error) return { ok: false, error: (error as { message?: string }).message ?? String(error) };
  return { ok: true, rows: (data ?? []) as SupplierRow[] };
}

async function insertChunks(sb: Db, table: string, rows: Record<string, unknown>[], out: PartyImportResult, count: 'debtors' | 'creditors'): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).insert(chunk);
    if (!error) { out[count] += chunk.length; continue; }
    for (const r of chunk) {
      const one = await sb.from(table).insert(r);
      // Already there (another import, or this batch saved before its answer was lost): kept, not an error.
      if (one.error?.code === '23505') out.kept += 1;
      else if (one.error) out.errors.push({ code: String(r.code), error: one.error.message });
      else out[count] += 1;
    }
  }
}

/** Write the parties of an imported chart. A customer or supplier already holding a code is kept as finance has it
    (only an empty control is filled); `supplierMatches` maps an AutoCount code to the ERP supplier that takes it. */
export async function importParties(
  sb: Db, companyId: number, parties: ParsedParty[], supplierMatches: Record<string, string>,
): Promise<PartyImportResult> {
  const out: PartyImportResult = { debtors: 0, creditors: 0, renamed: 0, kept: 0, errors: [] };
  const debtorParties = parties.filter((p) => p.kind === 'DEBTOR');
  const creditorParties = parties.filter((p) => p.kind === 'CREDITOR');

  if (debtorParties.length > 0) {
    const { data, error } = await paginateAll((from, to) => sb.from('debtors')
      .select('code').eq('company_id', companyId).order('code').range(from, to));
    if (error) {
      out.errors.push(...debtorParties.map((p) => ({ code: p.code, error: `The customers could not be read: ${(error as { message?: string }).message ?? ''}` })));
    } else {
      const have = new Set(((data ?? []) as Array<{ code: string }>).map((d) => d.code));
      const fresh = debtorParties.filter((p) => !have.has(p.code));
      out.kept += debtorParties.length - fresh.length;
      await insertChunks(sb, 'debtors', fresh.map((p) => ({
        company_id: companyId, code: p.code, name: p.name, control_account: p.controlCode, is_active: true,
      })), out, 'debtors');
    }
  }

  if (creditorParties.length > 0) {
    const sups = await supplierRows(sb, companyId);
    if (!sups.ok) {
      out.errors.push(...creditorParties.map((p) => ({ code: p.code, error: `The suppliers could not be read: ${sups.error}` })));
      return out;
    }
    const byId = new Map(sups.rows.map((s) => [s.id, s]));
    const byCode = new Map(sups.rows.map((s) => [s.code, s]));
    const fresh: Record<string, unknown>[] = [];
    for (const p of creditorParties) {
      const matchId = supplierMatches[p.code];
      if (matchId) {
        const s = byId.get(matchId);
        if (!s) { out.errors.push({ code: p.code, error: 'The supplier chosen for this code is not one of this company\'s.' }); continue; }
        const { error } = await sb.from('suppliers').update({ code: p.code, control_account: s.control_account ?? p.controlCode })
          .eq('id', s.id).eq('company_id', companyId);
        if (error) out.errors.push({ code: p.code, error: error.message });
        else out.renamed += 1;
        continue;
      }
      const same = byCode.get(p.code);
      if (same) {
        out.kept += 1;
        if (!same.control_account) {
          const { error } = await sb.from('suppliers').update({ control_account: p.controlCode }).eq('id', same.id).eq('company_id', companyId);
          if (error) out.errors.push({ code: p.code, error: error.message });
        }
        continue;
      }
      fresh.push({ company_id: companyId, code: p.code, name: p.name, control_account: p.controlCode });
    }
    await insertChunks(sb, 'suppliers', fresh, out, 'creditors');
  }
  return out;
}

/** A name folded for comparing: upper case, company suffixes and punctuation gone, split into words. */
function words(name: string): string[] {
  return name.toUpperCase()
    .replace(/\bSDN\.?\s*BHD\.?|\bS\/B\b|\bPLT\b|\bENTERPRISE\b|\(M\)/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

/** Which ERP supplier each AutoCount creditor most likely is. A pair scores the words the two names share over the
    words of the longer one (each word once), and needs the same first word and a score of at least a half. The best
    pairs are taken first, each side once; a supplier whose best score is shared by two creditors is left for finance
    to choose, and so is one already on an AutoCount code. */
export function suggestSupplierMatches(
  existing: Array<{ id: string; code: string; name: string }>, parties: ParsedParty[],
): Record<string, string> {
  const creditors = parties.filter((p) => p.kind === 'CREDITOR');
  const creditorCodes = new Set(creditors.map((p) => p.code));
  const candidates = existing.filter((s) => !creditorCodes.has(s.code) && !/^\d{3}-/.test(s.code));
  const pairs: Array<{ id: string; code: string; score: number }> = [];
  for (const s of candidates) {
    const sw = [...new Set(words(s.name))];
    for (const p of creditors) {
      const pw = [...new Set(words(p.name))];
      if (pw.length === 0 || sw.length === 0 || pw[0] !== sw[0]) continue;
      const score = pw.filter((w) => sw.includes(w)).length / Math.max(pw.length, sw.length);
      if (score >= 0.5) pairs.push({ id: s.id, code: p.code, score });
    }
  }
  const tied = new Set(candidates.map((s) => s.id).filter((id) => {
    const scores = pairs.filter((x) => x.id === id).map((x) => x.score).sort((a, b) => b - a);
    return scores.length > 1 && scores[0] === scores[1];
  }));
  const out: Record<string, string> = {};
  const usedSuppliers = new Set<string>();
  for (const x of pairs.filter((y) => !tied.has(y.id)).sort((a, b) => b.score - a.score)) {
    if (usedSuppliers.has(x.id) || x.code in out) continue;
    out[x.code] = x.id;
    usedSuppliers.add(x.id);
  }
  return out;
}

/* ── The control a party posts to (PR B; spec 2.4) ─────────────────────────────────────────────────────────── */

/** The control account a customer's receivables post to, from scm.debtors (an inactive customer keeps its control).
    No code, or a code with no row, is `control: null` — the caller then posts to the AR rule as before. A read that
    does not answer is `ok: false`: it must never read as "no control", or the line would land on the wrong one. */
export async function debtorControl(sb: Db, companyId: number | null, debtorCode: string | null | undefined): Promise<{ ok: true; control: string | null } | { ok: false; error: string }> {
  const code = String(debtorCode ?? '').trim();
  if (!code) return { ok: true, control: null };
  let q = sb.from('debtors').select('control_account').eq('code', code);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q.maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, control: (data as { control_account?: string | null } | null)?.control_account ?? null };
}

/** The posting roles with AR pointed at a customer's own control (unchanged when it has none). */
export function rolesForDebtor(roles: RoleCodes, control: string | null): RoleCodes {
  return control ? { ...roles, AR: control } : roles;
}

/** The payables control a supplier posts to: its own control, else today's rule (405- codes → AP_OTHER, others → AP). */
export function apControlFor(roles: RoleCodes, supplier: { code: string | null; control_account?: string | null }): string {
  return apControlOf(roles, supplier);
}

/** The company's posting roles with AR pointed at this customer's own control: what every receivable posting asks. */
export async function resolveDebtorRoles(sb: Db, companyId: number | null, debtorCode: string | null | undefined): Promise<{ ok: true; roles: RoleCodes } | { ok: false; error: string }> {
  const ctl = await debtorControl(sb, companyId, debtorCode);
  if (!ctl.ok) return { ok: false, error: `The customer's control could not be read: ${ctl.error}` };
  return { ok: true, roles: rolesForDebtor(await resolveRoles(sb, companyId), ctl.control) };
}

/* ── Opening a customer for a new order (PR B; spec 2.1, 2.3; SOP 2.1) ───────────────────────────────────── */

export type OrderKind = 'RENOVATION' | 'INHOUSE_RENOVATION' | 'STANDARD' | 'RENTAL';

/** The letter of a new code: a person addressed MR / MS (or MRS, MDM, MISS, MADAM) is M, as AutoCount codes them
    (301-M001); anyone else takes the first letter of the name, a name starting with a digit takes 0. */
export function debtorLetter(name: string): string {
  const n = name.trim().toUpperCase();
  if (/^(MR|MS|MRS|MDM|MISS|MADAM)\b/.test(n)) return 'M';
  const first = n.match(/[A-Z0-9]/)?.[0] ?? '0';
  return /[0-9]/.test(first) ? '0' : first;
}

/** The next code under a series: the highest running number of `prefix3-letter` plus one, three digits at least
    and no ceiling (301-M999 → 301-M1000). Codes whose rest is not a number are not counted. */
export function nextPartyCode(prefix3: string, letter: string, existing: string[]): string {
  const head = `${prefix3}-${letter}`;
  let max = 0;
  for (const code of existing) {
    if (!code.startsWith(head)) continue;
    const rest = code.slice(head.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${head}${String(max + 1).padStart(3, '0')}`;
}

/** The customer of a new order, as a debtor: the one already opened for this customer (by customer id, else by
    name and phone), or a new one under the control the order's kind maps to (scm.acc_debtor_control_map; none →
    the AR rule), coded the next in its series. Two orders opening one at the same time cannot take one code:
    the unique index refuses the second, which reads again and takes the next. */
export async function ensureDebtor(
  sb: Db, companyId: number,
  input: { name: string; phone: string | null; email?: string | null; customerId: string | null; orderKind: OrderKind },
): Promise<{ ok: true; code: string; created: boolean } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'A customer needs a name.' };
  const phone = input.phone?.trim() || null;
  const found = async (): Promise<{ ok: true; code: string | null } | { ok: false; error: string }> => {
    if (input.customerId) {
      const { data, error } = await sb.from('debtors').select('code').eq('company_id', companyId).eq('customer_id', input.customerId).limit(1);
      if (error) return { ok: false, error: error.message };
      const row = ((data ?? []) as Array<{ code: string }>)[0];
      if (row) return { ok: true, code: row.code };
    }
    /* By name only with a phone to go with it: two walk-ins called MR TAN with no number are two people. A debtor
       already tied to another customer is not this one. */
    if (!phone) return { ok: true, code: null };
    const { data, error } = await sb.from('debtors').select('id, code, name, customer_id')
      .eq('company_id', companyId).eq('phone', phone).order('code');
    if (error) return { ok: false, error: error.message };
    const same = ((data ?? []) as Array<{ id: string; code: string; name: string; customer_id: string | null }>)
      .find((d) => d.name.trim().toUpperCase() === name.toUpperCase() && (!d.customer_id || !input.customerId || d.customer_id === input.customerId));
    if (same && !same.customer_id && input.customerId) {
      const { error: tieErr } = await sb.from('debtors').update({ customer_id: input.customerId }).eq('company_id', companyId).eq('id', same.id);
      if (tieErr) return { ok: false, error: tieErr.message };
    }
    return { ok: true, code: same?.code ?? null };
  };
  const hit = await found();
  if (!hit.ok) return hit;
  if (hit.code) return { ok: true, code: hit.code, created: false };

  const { data: mapRow, error: mapErr } = await sb.from('acc_debtor_control_map').select('control_account')
    .eq('company_id', companyId).eq('order_kind', input.orderKind).maybeSingle();
  if (mapErr) return { ok: false, error: mapErr.message };
  const control = (mapRow as { control_account?: string } | null)?.control_account ?? (await resolveRoles(sb, companyId)).AR;
  const letter = debtorLetter(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: codes, error: codesErr } = await sb.from('debtors').select('code')
      .eq('company_id', companyId).like('code', `${control.slice(0, 3)}-${letter}%`);
    if (codesErr) return { ok: false, error: codesErr.message };
    const code = nextPartyCode(control.slice(0, 3), letter, ((codes ?? []) as Array<{ code: string }>).map((c) => c.code));
    const { error } = await sb.from('debtors').insert({
      company_id: companyId, code, name, control_account: control, customer_id: input.customerId, phone, email: input.email ?? null, is_active: true,
    });
    if (!error) return { ok: true, code, created: true };
    if (error.code !== '23505') return { ok: false, error: error.message };
    // Taken a moment ago — by this very customer on another order, or by another customer: look again.
    const again = await found();
    if (!again.ok) return again;
    if (again.code) return { ok: true, code: again.code, created: false };
  }
  return { ok: false, error: 'Could not find a free customer code; try again.' };
}

/** ensureDebtor inside a renovation transaction (lib/renovation-db: the engine's own database connection, not REST):
    the same finding, mapping and coding, in SQL. The insert skips a code taken a moment ago and the next one is
    tried, so the transaction never aborts on a clash. */
export async function ensureDebtorSql(
  db: { q<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]> },
  companyId: number,
  input: { name: string; phone: string | null; email?: string | null; customerId: string | null; orderKind: OrderKind },
): Promise<string> {
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  if (input.customerId) {
    const [byCustomer] = await db.q<{ code: string }>(
      'select code from scm.debtors where company_id = $1 and customer_id = $2 order by code limit 1', [companyId, input.customerId]);
    if (byCustomer) return byCustomer.code;
  }
  /* As ensureDebtor: by name only with a phone, and never a debtor already tied to another customer. */
  const [byName] = phone ? await db.q<{ code: string }>(
    `select code from scm.debtors where company_id = $1 and upper(btrim(name)) = upper(btrim($2))
        and btrim(phone) = $3 and (customer_id is null or $4::text is null or customer_id::text = $4::text) order by code limit 1`, [companyId, name, phone, input.customerId]) : [];
  if (byName) {
    if (input.customerId) {
      await db.q('update scm.debtors set customer_id = $3 where company_id = $1 and code = $2 and customer_id is null', [companyId, byName.code, input.customerId]);
    }
    return byName.code;
  }
  const [mapped] = await db.q<{ control_account: string }>(
    'select control_account from scm.acc_debtor_control_map where company_id = $1 and order_kind = $2', [companyId, input.orderKind]);
  const [role] = mapped ? [] : await db.q<{ account_code: string }>(
    `select account_code from scm.acc_account_roles where company_id = $1 and role = 'AR'`, [companyId]);
  const control = mapped?.control_account ?? role?.account_code ?? DEFAULT_ROLE_CODES.AR;
  const letter = debtorLetter(name);
  const series = `${control.slice(0, 3)}-${letter}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await db.q<{ code: string }>('select code from scm.debtors where company_id = $1 and code like $2', [companyId, `${series}%`]);
    const code = nextPartyCode(control.slice(0, 3), letter, taken.map((t) => t.code));
    const [made] = await db.q<{ code: string }>(
      `insert into scm.debtors (company_id, code, name, control_account, customer_id, phone, email, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, true) on conflict (company_id, code) do nothing returning code`,
      [companyId, code, name, control, input.customerId, phone, input.email ?? null]);
    if (made) return made.code;
  }
  throw new Error(`No free customer code in ${series}; try again.`);
}

/** The next supplier code under a control: its first three digits + the name's letter + the next running number
    of that series among the company's suppliers (SOP 2.1: creditors as customers). */
export async function nextSupplierCode(sb: Db, companyId: number | null, name: string, control: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const letter = debtorLetter(name);
  let q = sb.from('suppliers').select('code').like('code', `${control.slice(0, 3)}-${letter}%`);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, code: nextPartyCode(control.slice(0, 3), letter, ((data ?? []) as Array<{ code: string }>).map((r) => r.code)) };
}

/** What a party still has on a control: the sum of its lines there (a reversal and its original cancel out). A party
    is moved to another control only when this is nil — what it owes cannot follow it, as manual journals may not
    touch a control (acc/engine.ts), so a move with a balance would strand it on the old one. */
export async function partyBalanceOn(sb: Db, companyId: number, partyCode: string, accountCode: string): Promise<{ ok: true; balanceSen: number } | { ok: false; error: string }> {
  const { data, error } = await paginateAll((from, to) => sb.from('v_gl_entries').select('debit_sen, credit_sen')
    .eq('company_id', companyId).eq('party_code', partyCode).eq('account_code', accountCode).order('line_id').range(from, to));
  if (error) return { ok: false, error: (error as { message?: string }).message ?? String(error) };
  const balanceSen = ((data ?? []) as Array<{ debit_sen: number | null; credit_sen: number | null }>)
    .reduce((sum, l) => sum + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0), 0);
  return { ok: true, balanceSen };
}
