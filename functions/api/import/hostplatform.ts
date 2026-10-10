import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import {
  type Row, type ImportKind, IMPORT_KINDS, MAX_ROWS_PER_REQUEST, todayInKL,
  mapListing, mapReservations, mapWorkbookUnits, mapAirbnbEarnings, mapCleaning, mapWorkbookExpenses, mapPayoutHistory,
} from '../../_lib/hostplatformImport';
import {
  type Db, type ImportResult, importListing, importReservations, importWorkbookUnits, importAirbnbEarnings, importCleaning, importExpenses, importPayoutHistory, fixLocations,
} from '../../_lib/hostplatformImportDb';

/**
 * Import from HostPlatform · /system/integrations/hostplatform.
 * GET  -> the units already in Property OS, so the screen can say what is new and what will be updated.
 * POST { kind, rows, extra? } -> maps and writes one chunk (the screen sends at most ~500 rows at a time).
 * Re-running the same files updates the rows the last run wrote; nothing is duplicated. Nothing is sent to
 * Channex. Guest details never go into the audit log: one audit row per request, counts only.
 */

const allowed = (role: string) => MASTER_ROLES.includes(role) && !isFieldRole(role);
const dbFor = (env: Env): Db => ({
  all: (sql, ...args) => all(env, sql, ...args) as never,
  run: (sql, ...args) => run(env, sql, ...args),
});

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!allowed(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can import data.', 403);
  const units = await all<{ id: string; unit_number: string; property_id: string; property_name: string }>(env, `
    SELECT u.id, u.unit_number, u.property_id, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id`);
  const properties = await all<{ id: string; name: string }>(env, 'SELECT id, name FROM properties');
  const counts = await all<{ n: number }>(env, `SELECT count(*) AS n FROM reservations WHERE id LIKE 'hp-res-%'`);
  return json({
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyId: u.property_id, propertyName: u.property_name })),
    properties, importedReservations: Number(counts[0]?.n ?? 0),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!allowed(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can import data.', 403);

  const b = await request.json<{ kind?: string; rows?: unknown; extra?: Record<string, unknown> }>().catch(() => null);
  if (!b || !IMPORT_KINDS.includes(b.kind as ImportKind)) return fail('VALIDATION', 'Unknown import kind.', 422);
  if (!Array.isArray(b.rows) || b.rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return fail('VALIDATION', 'Rows must be a list of objects.', 422);
  if (b.rows.length > MAX_ROWS_PER_REQUEST) return fail('VALIDATION', `Send at most ${MAX_ROWS_PER_REQUEST} rows per request.`, 422);
  const rows = b.rows as Row[];
  const list = (k: string) => (Array.isArray(b.extra?.[k]) ? (b.extra![k] as Row[]) : []);
  const kind = b.kind as ImportKind, now = nowIso(), today = todayInKL(), db = dbFor(env);

  let result: ImportResult;
  try {
    switch (kind) {
      case 'listing': result = await importListing(db, mapListing(rows), now); break;
      case 'reservations': result = await importReservations(db, mapReservations(rows, today), now); break;
      case 'workbook_units': {
        const m = mapWorkbookUnits(rows, list('splits'), list('pool'), today);
        result = await importWorkbookUnits(db, m.units, now, today);
        result.errors.unshift(...m.errors); result.notes.push(...m.notes);
        break;
      }
      case 'workbook_airbnb': {
        const m = mapAirbnbEarnings(rows);
        result = await importAirbnbEarnings(db, m.earnings, today, now);
        result.errors.unshift(...m.errors); result.skippedRows.unshift(...m.skipped);
        break;
      }
      case 'workbook_cleaning': {
        const m = mapCleaning(rows, list('prices'));
        result = await importCleaning(db, m.cleanings, today, now);
        result.errors.unshift(...m.errors); result.skippedRows.unshift(...m.skipped);
        break;
      }
      case 'workbook_expenses': {
        const m = mapWorkbookExpenses(rows);
        result = await importExpenses(db, m.expenses, now, m.credits);
        result.errors.unshift(...m.errors); result.skippedRows.unshift(...m.skipped);
        break;
      }
      case 'fix_locations': result = await fixLocations(db, now); break;
      case 'workbook_payouts': {
        // The whole OWNER PAYOUT sheet in one request: an owner's units are summed into one statement per month.
        const m = mapPayoutHistory(rows, list('report'), today);
        result = await importPayoutHistory(db, m.months, now);
        result.errors.unshift(...m.errors); result.skippedRows.unshift(...m.skipped); result.notes.push(...m.notes);
        break;
      }
    }
    result.skipped = result.errors.length + result.skippedRows.length;
  } catch (e) {
    // One statement per table, so a failure leaves the tables written before it in place; re-running is safe.
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `import.hostplatform.${kind}.failed`, entityTable: 'import', entityId: kind, after: { rows: rows.length, error: message.slice(0, 300) } }).catch(() => {});
    return fail('IMPORT_FAILED', `This part of the import was not saved: ${message.slice(0, 300)}`, 500);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: `import.hostplatform.${kind}`, entityTable: 'import', entityId: kind,
    after: { rows: rows.length, tables: result.tables, errors: result.errors.length, skipped: result.skippedRows.length, stats: result.stats ?? null },
  });
  return json(result);
};
