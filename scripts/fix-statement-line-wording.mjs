// Rewrites the wording of statement lines already in a database to the owner's report words (src/lib/statementTerms.ts),
// the same words the statement generator and the owner-workbook import now write. Amounts, dates, types, categories and
// units are never changed; only `description`, and `reference` where it is the import's "Owner workbook" source tag.
//
//   node scripts/fix-statement-line-wording.mjs --env-file=.dev.vars.production              show what would change (changes nothing)
//   node scripts/fix-statement-line-wording.mjs --env-file=.dev.vars.production --apply      change it, in one transaction
//   DATABASE_URL=postgres://... node scripts/fix-statement-line-wording.mjs [--apply]
//
// Idempotent: a second run finds nothing to change. Prints the target database, counts before and after, and examples.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const envFile = process.argv.find(a => a.startsWith('--env-file='))?.slice('--env-file='.length);
const fromFile = envFile ? readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1] : undefined;
const url = process.env.DATABASE_URL ?? fromFile;
if (!url) { console.error('Set DATABASE_URL or pass --env-file=<file with DATABASE_URL>. Nothing was changed.'); process.exit(2); }
let target;
try { const u = new URL(url); target = `${u.hostname}:${u.port || 5432}${u.username.includes('.') ? ` (project ${u.username.split('.')[1]})` : ''}`; }
catch { console.error('DATABASE_URL is not a valid connection string. Nothing was changed.'); process.exit(2); }

const out = await build({ entryPoints: [join(root, 'src/lib/statementTerms.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'terms-'));
writeFileSync(join(tmp, 't.mjs'), out.outputFiles[0].text);
const { TERMS, deductionTerm, toOperator } = await import(pathToFileURL(join(tmp, 't.mjs')).href);

/** The description the line would carry if it were written today; null = leave it. */
export function reword(l) {
  const d = String(l.description ?? '');
  const unit = l.unit_label ?? '';
  const workbook = /\(owner workbook(, no breakdown)?\)\s*$/i.test(d);
  const noUnit = s => (unit && s.startsWith(`${unit} · `) ? s.slice(unit.length + 3) : unit && s.startsWith(`${unit}: `) ? s.slice(unit.length + 2) : s);
  switch (l.line_type) {
    case 'gross':
      if (workbook) return TERMS.hospitalityIncome;
      if (l.category === 'long_term_rent') {
        const m = /monthly rent(?: from (.+?))?(?: \(\d+ of \d+ days\))?$/i.exec(noUnit(d));
        return m ? `${TERMS.monthlyRent}${m[1] ? ` · ${m[1]}` : ''}` : null;
      }
      return noUnit(d);
    case 'expense':
      if (workbook) {
        if (l.category === 'other') return /miscellaneous/i.test(d) ? deductionTerm('misc') : deductionTerm('additional');
        return deductionTerm(l.category);
      }
      if (l.category === 'misc' && /^miscellaneous charges/i.test(d)) return deductionTerm('misc');
      return null;
    case 'management_fee': {
      if (workbook) return TERMS.toOperator;
      const m = /^(\d+(?:\.\d+)?)% to operator$/i.exec(d) ?? /^management fee (\d+(?:\.\d+)?)% of the rent$/i.exec(d);
      return m ? toOperator(Number(m[1])) : null;
    }
    case 'adjustment':
      if (l.category === 'guarantee_top_up') return TERMS.topUp;
      if (l.category === 'fixed_rent') return TERMS.fixedRent;
      if (l.category === 'workbook_payout' && workbook) return /top-up/i.test(d) ? (l.grr ? TERMS.fixedRentTopUp : TERMS.topUp) : TERMS.payout;
      return null;
    default: return null;
  }
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: 'pos' } });
try {
  const rows = await sql`
    SELECT l.id, l.line_type, l.category, l.description, l.reference, p.name || ' ' || u.unit_number AS unit_label,
           (COALESCE(c.revenue_model, c.model) = 'grr') AS grr
    FROM statement_lines l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id`;
  const changes = [];
  for (const r of rows) {
    const next = reword(r);
    const description = next ?? r.description;
    const reference = r.reference && /^owner workbook$/i.test(r.reference.trim()) ? null : r.reference;
    if (description !== r.description || reference !== r.reference) changes.push({ id: r.id, description, reference, before: r.description });
  }
  const tagged = rows.filter(r => /\(owner workbook/i.test(r.description ?? '') || /^owner workbook$/i.test(r.reference ?? '')).length;
  console.log(`database: ${target}`);
  console.log(`statement lines: ${rows.length}; carrying the import's tag: ${tagged}; to reword: ${changes.length}`);
  for (const c of changes.slice(0, 12)) console.log(`  "${c.before}"  ->  "${c.description}"`);
  if (!APPLY) { console.log('\nDry run: nothing was changed. Add --apply to write it.'); process.exit(0); }
  await sql.begin(async tx => {
    for (let i = 0; i < changes.length; i += 500) {
      const part = changes.slice(i, i + 500).map(({ id, description, reference }) => ({ id, description, reference }));
      await tx.unsafe(`
        UPDATE statement_lines l SET description = x.description, reference = x.reference
        FROM jsonb_to_recordset($1::jsonb) AS x(id text, description text, reference text) WHERE l.id = x.id`, [JSON.stringify(part)]);
    }
  });
  const after = await sql`SELECT COUNT(*)::int AS n FROM statement_lines WHERE description ILIKE '%(owner workbook%' OR reference ILIKE 'owner workbook'`;
  console.log(`\nApplied: ${changes.length} lines reworded. Lines still carrying the import's tag: ${after[0].n}.`);
} finally { await sql.end(); }
