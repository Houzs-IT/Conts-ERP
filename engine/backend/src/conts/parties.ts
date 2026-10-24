// Conts only (not part of Houzs's code): customers and suppliers under their control (finance phase 1.5, spec
// docs/superpowers/specs/2026-10-23-finance-debtors-contracts-design.md section 2; SOP 2.1). AutoCount keeps each
// customer (SDR) and supplier (SCR) as a sub-account of its control; here the control is the only account, the
// customer is a row of scm.debtors and the supplier a row of scm.suppliers, each naming its control.
import { paginateAll } from '../scm/lib/paginate-all';

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
