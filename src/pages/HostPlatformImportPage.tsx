import { useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { FileDropRow } from '../components/Attachments';
import { DateField } from '../components/inputs';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { csvObjects, readXlsx, sheetObjects, type SheetRow } from '../lib/sheets';
import { count as n, dateRange, plural } from '../lib/format';
import { moneyString } from '../components/MoneyText';
import { go } from '../lib/go';
import {
  type Row, type RowError, type KnownUnit, type ImportKind,
  LISTING_COLUMNS, RESERVATION_COLUMNS, WORKBOOK_SHEETS, WORKBOOK_KEY, WORKBOOK_COLUMNS, WORKBOOK_HEADER_ROW,
  mapListing, mapReservations, mapWorkbookUnits, mapAirbnbEarnings, mapCleaning, mapWorkbookExpenses, mapPayoutHistory,
  matchWorkbookUnit, unitKey, todayInKL, chunkByKey, pick, poolSheetRows,
} from '../../functions/_lib/hostplatformImport';

/**
 * Import from HostPlatform · /system/integrations/hostplatform.
 * Files are read here in the browser; only the columns the import uses are sent, 200 rows at a time.
 * The server derives every id from the source, so running a step again updates instead of duplicating.
 */

interface Existing { units: { id: string; unitNumber: string; propertyId: string; propertyName: string }[]; properties: { id: string; name: string }[]; importedReservations: number }
interface Result { created: number; updated: number; skipped: number; errors: RowError[]; skippedRows: RowError[]; notes: string[]; tables: Record<string, { created: number; updated: number }>; stats?: Record<string, number>; missing?: RowError[] }
interface Run { done: number; total: number; result: Result | null; failed: string | null; busy: boolean; preview?: boolean }

// Small parts keep each request well inside a Worker's CPU allowance (about 4 ms of mapping per 200 bookings measured locally).
const CHUNK = 200;
const rm = (sen: number) => moneyString(sen, 'exact');
const tally = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const chunks = <T,>(xs: T[], size = CHUNK) => { const o: T[][] = []; for (let i = 0; i < xs.length; i += size) o.push(xs.slice(i, i + size)); return o; };
const CHANNEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', maintenance_block: 'Blocks', owner_stay: 'Owner stays' };
const STATE: Record<string, string> = { confirmed: 'Upcoming', checked_in: 'Currently hosting', checked_out: 'Past', cancelled: 'Cancelled' };

function merge(a: Result | null, b: Result): Result {
  if (!a) return b;
  const tables = { ...a.tables };
  for (const [t, v] of Object.entries(b.tables)) tables[t] = { created: (tables[t]?.created ?? 0) + v.created, updated: (tables[t]?.updated ?? 0) + v.updated };
  const stats = { ...(a.stats ?? {}) };
  for (const [k, v] of Object.entries(b.stats ?? {})) stats[k] = (stats[k] ?? 0) + v;
  return {
    created: a.created + b.created, updated: a.updated + b.updated, skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors], skippedRows: [...a.skippedRows, ...b.skippedRows], missing: [...(a.missing ?? []), ...(b.missing ?? [])],
    notes: [...new Set([...a.notes, ...b.notes])], tables, stats,
  };
}

async function readText(f: File) { return csvObjects(await f.text()).rows; }

export default function HostPlatformImportPage() {
  const existing = useApi<Existing>('/import/hostplatform');
  const known: KnownUnit[] = existing.data?.units ?? [];

  const [listing, setListing] = useState<{ name: string; rows: SheetRow[] } | null>(null);
  const [reservations, setReservations] = useState<{ names: string[]; rows: SheetRow[] } | null>(null);
  const [workbook, setWorkbook] = useState<{ name: string; sheets: Record<string, SheetRow[]>; missing: string[] } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Partial<Record<ImportKind, Run>>>({});
  const today = todayInKL();

  async function pickListing(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setReadError(null);
    try { setListing({ name: f.name, rows: await readText(f) }); } catch { setReadError(`${f.name} could not be read as a CSV file.`); }
  }
  async function pickReservations(files: FileList | null) {
    // The input is cleared right after this is called, which empties the live FileList: copy it first.
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setReadError(null);
    try {
      const all: SheetRow[] = [];
      for (const f of list) all.push(...(await readText(f)));
      setReservations({ names: list.map(f => f.name), rows: all });
    } catch { setReadError('One of the reservation files could not be read as a CSV file.'); }
  }
  async function pickWorkbook(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setReadError(null);
    try {
      const wanted = Object.values(WORKBOOK_SHEETS) as string[];
      const { sheets, names } = await readXlsx(await f.arrayBuffer(), wanted);
      const out: Record<string, SheetRow[]> = {};
      for (const s of wanted) out[s] = pick(s === WORKBOOK_SHEETS.pool ? poolSheetRows(sheets[s] ?? []) : sheetObjects(sheets[s] ?? [], WORKBOOK_HEADER_ROW[s] ?? 1, s), WORKBOOK_COLUMNS[s]) as SheetRow[];
      setWorkbook({ name: f.name, sheets: out, missing: wanted.filter(s => !names.includes(s)) });
    } catch (e) { setReadError(errorMessage(e, `${f.name} could not be read.`)); }
  }

  /* ---------- previews: the same mapping the server runs ---------- */
  const listingPlan = useMemo(() => listing ? mapListing(pick(listing.rows, LISTING_COLUMNS)) : null, [listing]);
  const resPlan = useMemo(() => reservations ? mapReservations(pick(reservations.rows, RESERVATION_COLUMNS), today) : null, [reservations, today]);
  const wb = workbook?.sheets;
  const wbUnits = useMemo(() => wb ? mapWorkbookUnits(wb[WORKBOOK_SHEETS.units], wb[WORKBOOK_SHEETS.splits], wb[WORKBOOK_SHEETS.pool], today) : null, [wb, today]);
  const wbAirbnb = useMemo(() => wb ? mapAirbnbEarnings(wb[WORKBOOK_SHEETS.airbnb]) : null, [wb]);
  const wbCleaning = useMemo(() => wb ? mapCleaning(wb[WORKBOOK_SHEETS.cleaning], wb[WORKBOOK_SHEETS.cleaningPrices]) : null, [wb]);
  const expenseRows = useMemo(() => wb ? [WORKBOOK_SHEETS.water, WORKBOOK_SHEETS.electricity, WORKBOOK_SHEETS.internet, WORKBOOK_SHEETS.sewerage, WORKBOOK_SHEETS.misc].flatMap(s => wb[s]) : [], [wb]);
  const wbExpenses = useMemo(() => wb ? mapWorkbookExpenses(expenseRows) : null, [wb, expenseRows]);
  const wbPayouts = useMemo(() => wb ? mapPayoutHistory(wb[WORKBOOK_SHEETS.payouts], wb[WORKBOOK_SHEETS.report], today) : null, [wb, today]);

  // Units the screen can see: those already in Property OS plus, before step 1 runs, the ones the listing will add.
  const visibleUnits = useMemo(() => {
    const list: KnownUnit[] = [...known];
    for (const u of listingPlan?.units ?? []) if (!list.some(k => unitKey(k.propertyName, k.unitNumber) === unitKey(u.building, u.unitNumber))) list.push({ id: u.id, unitNumber: u.unitNumber, propertyId: u.propertyId, propertyName: u.building });
    return list;
  }, [known, listingPlan]);

  /* ---------- sending ---------- */
  async function send(kind: ImportKind, parts: Row[][], extra?: Record<string, Row[]>) {
    setRuns(r => ({ ...r, [kind]: { done: 0, total: parts.length, result: null, failed: null, busy: true } }));
    let result: Result | null = null;
    for (let i = 0; i < parts.length; i++) {
      try {
        const res = await api.post<Result>('/import/hostplatform', { kind, rows: parts[i], extra });
        result = merge(result, res);
        setRuns(r => ({ ...r, [kind]: { done: i + 1, total: parts.length, result, failed: null, busy: i + 1 < parts.length } }));
      } catch (e) {
        const msg = errorMessage(e, 'The connection dropped.');
        setRuns(r => ({ ...r, [kind]: { done: i, total: parts.length, result, failed: `Stopped at part ${i + 1} of ${parts.length}: ${msg} Everything before it is saved; run this step again to finish (nothing is duplicated).`, busy: false } }));
        return;
      }
    }
    if (kind === 'listing' || kind === 'workbook_units') existing.reload();
  }

  const listingNew = listingPlan ? listingPlan.units.filter(u => !known.some(k => k.id === u.id || (k.propertyName.toLowerCase() === u.building.toLowerCase() && k.unitNumber.toLowerCase() === u.unitNumber.toLowerCase()))).length : 0;
  const unmatchedRes = resPlan ? resPlan.reservations.filter(r => !visibleUnits.some(k => unitKey(k.propertyName, k.unitNumber) === unitKey(r.building, r.unitNumber))) : [];
  const match = useMemo(() => {
    if (!wbUnits) return null;
    const hit = new Set<string>(); let matched = 0;
    for (const u of wbUnits.units) { const h = matchWorkbookUnit(u.workbookId, visibleUnits); if (h) { matched++; hit.add(h.id); } }
    const hp = visibleUnits.filter(u => u.id.startsWith('hp-unit-')).length;
    return { matched, workbookOnly: wbUnits.units.length - matched, hostPlatformOnly: Math.max(0, hp - [...hit].filter(id => id.startsWith('hp-unit-')).length) };
  }, [wbUnits, visibleUnits]);
  const range = resPlan?.reservations.length ? dateRange(resPlan.reservations.reduce((m, r) => (r.checkIn < m ? r.checkIn : m), '9999'), resPlan.reservations.reduce((m, r) => (r.checkOut > m ? r.checkOut : m), '0000')) : '';
  const done = (k: ImportKind) => !!runs[k]?.result && !runs[k]?.busy && !runs[k]?.failed;

  return (
    <>
      <PageHeader
        title="Import from HostPlatform"
        sub="9 steps · units, reservations, the owner workbook and two clean-ups"
        back={{ label: 'Integrations', onClick: () => { go('/system/integrations'); } }}
      />

      {existing.error && <StaleBanner message={`Could not read the units already in Property OS, so every unit is counted as new in the previews below. ${existing.error}`} onRetry={existing.reload} />}
      {readError && <div role="alert" className="text-copy text-danger">{readError}</div>}

      <Card>
        <div className="py-4 px-5 flex flex-col gap-1.5 text-copy leading-[1.5] text-[var(--color-ink-2)]">
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Run the steps in order</span>
          <span>Safe to run again until cutover: a second run updates what the first one wrote and never adds duplicates.</span>
          <span>Reservations attach to units, and the workbook's money attaches to reservations, so each step needs the one before it. Nothing here is sent to Airbnb, Booking.com or Channex: these reservations already exist on the channels.</span>
          <span>Files stay on this computer; only the columns the import needs are sent. Card and identity numbers in the HostPlatform exports are never sent.</span>
        </div>
      </Card>

      <ApiPull />

      <Step no={1} title="HostPlatform listing" hint="The units export (listing.csv). Creates the buildings and units." run={runs.listing}
        picker={<FileDropRow label="Choose listing CSV" hint="listing.csv from HostPlatform" chosen={listing?.name} accept=".csv,text/csv" onPick={pickListing} />}
        preview={listingPlan && (
          <Stats items={[
            ['Buildings', n(listingPlan.properties.length)], ['Units', n(listingPlan.units.length)],
            ['New', n(listingNew)], ['Already in Property OS', n(listingPlan.units.length - listingNew)],
            ['Owners named', n(listingPlan.owners.length)], ['Monthly costs', n(listingPlan.unitExpenses.length)],
          ]} errors={listingPlan.errors} notes={listingPlan.notes} />
        )}
        action={listingPlan && <Button variant="primary" size="sm" loading={runs.listing?.busy} disabled={!listingPlan.units.length} disabledReason="The file has no units."
          onClick={() => send('listing', [pick(listing!.rows, LISTING_COLUMNS)])}>Import {n(listingPlan.units.length)} units</Button>} />

      <Step no={2} title="Owner workbook: units, owners and contracts" hint="The owner's operations workbook (.xlsx). Names the real owners, bank details, splits, packages (A to D), contract terms, utility account numbers, debts and the Package D guarantee pool. Also feeds steps 4 to 7." run={runs.workbook_units}
        waitFor={!done('listing') && !known.length ? 'Run step 1 first.' : null}
        picker={<FileDropRow label="Choose workbook (.xlsx)" hint="The owner operations workbook" chosen={workbook?.name} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onPick={pickWorkbook} />}
        preview={wbUnits && match && (
          <Stats items={[
            ['Units in workbook', n(wbUnits.units.length)], ['Match a HostPlatform unit', n(match.matched)],
            ['Workbook only (created)', n(match.workbookOnly)], ['HostPlatform only', n(match.hostPlatformOnly)],
            ['With a contract', n(wbUnits.units.filter(u => u.contract).length)],
          ]} errors={wbUnits.errors} notes={[...(workbook?.missing.length ? [`Sheets not found: ${workbook.missing.join(', ')}.`] : []), ...wbUnits.notes]} />
        )}
        action={wbUnits && <Button variant="primary" size="sm" loading={runs.workbook_units?.busy} disabled={!wbUnits.units.length} disabledReason="The workbook has no units."
          onClick={() => send('workbook_units', [wb![WORKBOOK_SHEETS.units]], { splits: wb![WORKBOOK_SHEETS.splits], pool: wb![WORKBOOK_SHEETS.pool] })}>Import {n(wbUnits.units.length)} units</Button>} />

      <Step no={3} title="HostPlatform reservations" hint="One or more reservation exports (CSV). Pick them all at once." run={runs.reservations}
        waitFor={!done('listing') && !known.length ? 'Run step 1 first.' : null}
        picker={<FileDropRow label="Choose reservation CSVs" hint="Pick or drop them all at once" chosen={reservations?.names.join(', ')} accept=".csv,text/csv" multiple onPick={pickReservations} />}
        preview={resPlan && (
          <Stats items={[
            ['Reservations', n(resPlan.reservations.length)], ['Dates', range],
            ...Object.entries(tally(resPlan.reservations, r => r.channel)).map(([k, v]) => [CHANNEL[k] ?? k, n(v)] as [string, string]),
            ...Object.entries(tally(resPlan.reservations, r => r.state)).map(([k, v]) => [STATE[k] ?? k, n(v)] as [string, string]),
            ['Unit not found', n(unmatchedRes.length)],
          ]} errors={resPlan.errors} notes={unmatchedRes.length ? [`${n(unmatchedRes.length)} reservations are on units that are not in Property OS and will be refused. Import the listing first.`] : []} />
        )}
        action={resPlan && <Button variant="primary" size="sm" loading={runs.reservations?.busy} disabled={!resPlan.reservations.length} disabledReason="No reservations in the files."
          onClick={() => send('reservations', chunks(pick(reservations!.rows, RESERVATION_COLUMNS)))}>Import {n(resPlan.reservations.length)} reservations</Button>} />

      <Step no={4} title="Owner workbook: Airbnb earnings" hint="The Airbnb order data sheet. Replaces HostPlatform's amounts with the host payout, service fee and guest total from Airbnb's earnings report, and adds reservations HostPlatform never had. A reservation of 28 nights or more that Airbnb pays in monthly instalments is summed over all its lines, and each instalment is listed on the reservation (paid, or still to come)." run={runs.workbook_airbnb}
        waitFor={!wb ? 'Choose the workbook in step 2.' : null}
        preview={wbAirbnb && (
          <Stats items={[
            ['Reservations', n(wbAirbnb.earnings.length)], ['Host payout lines', n(wbAirbnb.earnings.reduce((s, e) => s + e.instalments.length, 0))], ['Airbnb', n(wbAirbnb.earnings.filter(e => e.site === 'airbnb').length)],
            ['Booking.com', n(wbAirbnb.earnings.filter(e => e.site === 'booking_com').length)], ['Skipped', n(wbAirbnb.skipped.length)],
          ]} errors={wbAirbnb.errors} notes={wbAirbnb.skipped.length ? [`${n(wbAirbnb.skipped.length)} lines are skipped: ${Object.entries(tally(wbAirbnb.skipped, s => s.reason)).map(([k, v]) => `${v} × ${k}`).join(' ')}`] : []} />
        )}
        action={wbAirbnb && <Button variant="primary" size="sm" loading={runs.workbook_airbnb?.busy} disabled={!wbAirbnb.earnings.length} disabledReason="No earnings lines."
          onClick={() => send('workbook_airbnb', chunkByKey(wb![WORKBOOK_SHEETS.airbnb], r => String(r[WORKBOOK_KEY.airbnbConfirmation] ?? ''), CHUNK))}>Import {n(wbAirbnb.earnings.length)} reservations</Button>} />

      <Step no={5} title="Owner workbook: cleaning records" hint="The cleaning records and cleaning prices sheets. Each cleaning record becomes a cleaning job (done if the date has passed) given to the cleaner named in the person-in-charge column, who joins the cleaner roster, and, when the owner pays, a cleaning expense at the unit's price." run={runs.workbook_cleaning}
        waitFor={!wb ? 'Choose the workbook in step 2.' : null}
        preview={wbCleaning && (
          <Stats items={[
            ['Cleaning jobs', n(wbCleaning.cleanings.length)], ['Basic', n(wbCleaning.cleanings.filter(c => c.kind === 'turnover').length)],
            ['Deep / move-out', n(wbCleaning.cleanings.filter(c => c.kind === 'deep_clean').length)],
            ['Charged to owner', rm(wbCleaning.cleanings.filter(c => !c.payer).reduce((s, c) => s + (c.price ?? 0), 0))], ['Skipped', n(wbCleaning.skipped.length)],
          ]} errors={wbCleaning.errors} notes={[]} />
        )}
        action={wbCleaning && <Button variant="primary" size="sm" loading={runs.workbook_cleaning?.busy} disabled={!wbCleaning.cleanings.length} disabledReason="No cleaning records."
          onClick={() => send('workbook_cleaning', chunks(wb![WORKBOOK_SHEETS.cleaning]), { prices: wb![WORKBOOK_SHEETS.cleaningPrices] })}>Import {n(wbCleaning.cleanings.length)} cleaning jobs</Button>} />

      <Step no={6} title="Owner workbook: utilities and charges" hint="The water, electricity, internet, INDAH WATER and miscellaneous deductions sheets. Each month's bill becomes an expense dated the 1st of that month. Miscellaneous deduction 'Additional Deduction' lines are costs taken off before the split; 'O2' lines are owner adjustments added to the owner payout after the split, sign as written." run={runs.workbook_expenses}
        waitFor={!wb ? 'Choose the workbook in step 2.' : null}
        preview={wbExpenses && (
          <Stats items={[
            ['Expenses', n(wbExpenses.expenses.length)], ['Total', rm(wbExpenses.expenses.reduce((s, e) => s + e.amount, 0))],
            ['Owner adjustments', n(wbExpenses.credits.length)], ['Net to owners', rm(wbExpenses.credits.reduce((s, c) => s + c.amount, 0))],
            ...Object.entries(tally(wbExpenses.expenses, e => e.category)).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), n(v)] as [string, string]),
            ['Skipped', n(wbExpenses.skipped.length)],
          ]} errors={wbExpenses.errors} notes={wbExpenses.credits.length ? [`${n(wbExpenses.credits.length)} lines are money back to the owner. They are kept as owner adjustments: credits dated in a month step 7 covers were already in that month's owner payout; later ones go on the next owner statement.`] : []} />
        )}
        action={wbExpenses && <Button variant="primary" size="sm" loading={runs.workbook_expenses?.busy} disabled={!wbExpenses.expenses.length} disabledReason="No expenses."
          onClick={() => send('workbook_expenses', chunks(expenseRows))}>Import {n(wbExpenses.expenses.length)} expenses</Button>} />

      <Step no={7} title="Owner workbook: owner payout history" hint="The OWNER PAYOUT and overall report sheets. Each past month becomes a paid owner statement and owner payout, marked as from the workbook, so owners and finance see the history. The current month and later are never touched. Run after step 6." run={runs.workbook_payouts}
        waitFor={!wb ? 'Choose the workbook in step 2.' : null}
        preview={wbPayouts && (
          <Stats items={[
            ['Unit-months', n(wbPayouts.months.length)], ['Months', n(new Set(wbPayouts.months.map(m => m.month)).size)],
            ['Paid to owners', rm(wbPayouts.months.reduce((s, m) => s + m.amount, 0))],
            ['With breakdown', n(wbPayouts.months.filter(m => m.breakdown).length)],
          ]} errors={wbPayouts.errors} notes={[...wbPayouts.notes, ...wbPayouts.skipped.map(s => s.reason)]} />
        )}
        action={wbPayouts && <Button variant="primary" loading={runs.workbook_payouts?.busy} disabled={!wbPayouts.months.length} disabledReason="No past owner payouts in the sheet."
          onClick={() => send('workbook_payouts', [wb![WORKBOOK_SHEETS.payouts]], { report: wb![WORKBOOK_SHEETS.report] })}>Import {n(wbPayouts.months.length)} unit-months</Button>} />

      <Step no={8} title="Tidy building states and cities" hint="One-off clean-up of buildings already in Property OS: writes each state and city one way ('W.P Kuala Lumpur' and 'WP' become 'Kuala Lumpur', 'KUALA LUMPUR' becomes 'Kuala Lumpur') and fills a blank one from the postcode or address. A state it does not recognise is left as typed. Needs no file; running it again changes nothing." run={runs.fix_locations}
        action={<Button variant="primary" loading={runs.fix_locations?.busy} onClick={() => send('fix_locations', [[]])}>Tidy buildings</Button>} />

      <Step no={9} title="Split nameless channel guests" hint="One-off clean-up. Reservations that came without a guest name all went under one guest called 'Airbnb guest' (or 'Booking.com guest'), so 23 reservations looked like one person's. This gives each of those reservations its own guest, named with the reservation's reference ('Airbnb guest HM...'), and removes the empty placeholder. Needs no file; running it again changes nothing." run={runs.fix_guests}
        action={<Button variant="primary" loading={runs.fix_guests?.busy} onClick={() => send('fix_guests', [[]])}>Split guests</Button>} />
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Reservations straight from the HostPlatform API, one HostPlatform property per request (functions/api/import/hostplatform-api.ts).
 *  Updates the bookings already here by their HostPlatform code and adds the missing ones; never deletes. */
function ApiPull() {
  const info = useApi<{ configured: boolean; properties: { id: string; name: string }[] }>('/import/hostplatform-api');
  const [from, setFrom] = useState('2026-08-01');
  const [run, setRun] = useState<Run>();
  // Saving unlocks only once a preview of the same start date has finished.
  const [previewedFrom, setPreviewedFrom] = useState<string | null>(null);
  const properties = info.data?.properties ?? [];

  async function pull(preview: boolean) {
    setRun({ done: 0, total: properties.length, result: null, failed: null, busy: true, preview });
    if (preview) setPreviewedFrom(null);
    let result: Result | null = null;
    for (const [i, p] of properties.entries()) {
      try {
        const res = await api.post<Result & { pulled: number; blocks: number; cancelled: string[]; checkoutMoved: string[] }>('/import/hostplatform-api', { propertyId: p.id, from, preview });
        const notes = [
          ...res.notes,
          ...(res.cancelled.length ? [`${p.name}: ${preview ? 'would cancel' : 'cancelled'} ${res.cancelled.join(', ')}`] : []),
          ...(res.checkoutMoved.length ? [`${p.name}: checkout ${preview ? 'would move' : 'moved'} for ${res.checkoutMoved.join(', ')}`] : []),
        ];
        result = merge(result, { ...res, notes, stats: { pulled: res.pulled, blocks: res.blocks } });
        setRun({ done: i + 1, total: properties.length, result, failed: null, busy: i + 1 < properties.length, preview });
      } catch (e) {
        const after = preview ? 'Nothing was saved; preview again.' : 'Everything before it is saved; pull again to finish (nothing is duplicated).';
        setRun({ done: i, total: properties.length, result, failed: `Stopped at ${p.name}: ${errorMessage(e, 'The connection dropped.')} ${after}`, busy: false, preview });
        return;
      }
    }
    if (preview) setPreviewedFrom(from);
  }

  const hint = info.data && !info.data.configured
    ? 'Not set up here yet: HOSTPLATFORM_BASE_URL and the HOSTPLATFORM_ACCESS_TOKEN secret are needed.'
    : 'Reads every reservation from the date below onward, cancellations included, straight from HostPlatform. Preview first: it shows what would be added, changed, cancelled and left out, and saves nothing. Reservations already here keep their amounts, notes, guest and check-in/out; only dates, unit, guest count and cancellations follow HostPlatform. Nothing is deleted and nothing is sent to HostPlatform.';
  const busy = !!run?.busy;
  return (
    <Step no="API" title="Pull reservations from HostPlatform" hint={hint} run={run}
      picker={info.data?.configured && <div className="max-w-[220px]"><DateField label="Stays from" value={from} onChange={setFrom} /></div>}
      action={info.data?.configured && <>
        <Button variant="primary" size="sm" loading={busy && run?.preview} disabled={!properties.length || !from || busy} disabledReason={busy ? 'A pull is running.' : 'HostPlatform returned no buildings.'}
          onClick={() => pull(true)}>Preview {plural(properties.length, 'building')}</Button>
        <Button variant="secondary" size="sm" loading={busy && !run?.preview} disabled={busy || previewedFrom !== from} disabledReason={busy ? 'A pull is running.' : 'Preview this start date first.'}
          onClick={() => pull(false)}>Pull and save</Button>
      </>} />
  );
}

function Step({ no, title, hint, picker, preview, action, run, waitFor }: {
  no: number | string; title: string; hint: string; picker?: ReactNode; preview?: ReactNode; action?: ReactNode; run?: Run; waitFor?: string | null;
}) {
  const state = run?.failed ? { label: 'Stopped', tone: 'critical' as const }
    : run?.busy ? { label: run.preview ? 'Previewing' : 'Importing', tone: 'info' as const }
    : run?.result ? { label: run.preview ? 'Preview only' : 'Imported', tone: run.preview ? 'info' as const : 'success' as const } : null;
  return (
    <Card>
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex-none grid place-items-center w-7 h-7 rounded-full bg-page [border:1px_solid_var(--color-line-soft)] text-copy font-semibold">{no}</span>
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
            <span className="text-meta leading-[1.5] text-muted-ink [text-wrap:pretty]">{hint}</span>
          </div>
          {state && <StatusBadge tone={state.tone} label={state.label} />}
        </div>
        {waitFor && !run && !preview && <div className="text-meta text-muted-ink">{waitFor}</div>}
        {picker}
        {preview}
        {run && run.total > 0 && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <div className="h-[6px] rounded-full bg-page overflow-hidden [border:1px_solid_var(--color-line-soft)]">
              <div className="h-full bg-[var(--color-brand-gold)] transition-[width] duration-200" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} />
            </div>
            <span className="text-meta text-muted-ink">{n(run.done)} of {plural(run.total, 'part')} sent</span>
          </div>
        )}
        {run?.failed && <div role="alert" className="text-copy text-danger">{run.failed}</div>}
        {run?.result && <ResultView r={run.result} preview={run.preview} />}
      </div>
      {action && (
        <div className="flex items-center gap-2 flex-wrap py-3 px-5 [border-top:1px_solid_var(--color-line-soft)]">
          {action}
          {run?.result && !run.busy && <span className="text-meta text-muted-ink">Running it again updates the same rows.</span>}
        </div>
      )}
    </Card>
  );
}

function Stats({ items, errors, notes }: { items: [string, string][]; errors: RowError[]; notes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 py-2.5 px-3 rounded-control border border-solid border-line-soft min-w-0">
            <span className="text-meta text-muted-ink">{k}</span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] [font-variant-numeric:tabular-nums] break-words">{v}</span>
          </div>
        ))}
      </div>
      {notes.map(t => <p key={t} className="m-0 text-meta leading-[1.5] text-[var(--color-ink-2)] [text-wrap:pretty]">{t}</p>)}
      <RowList title={errors.length === 1 ? 'row will be refused' : 'rows will be refused'} rows={errors} />
    </div>
  );
}

/** "Row 12", or "Row 328 of <sheet>" when the row came from a named workbook sheet (it arrives as "<sheet> row 328"). */
const rowLabel = (row: RowError['row']) => { const m = /^(.*) row (\d+)$/.exec(String(row)); return m ? `Row ${m[2]} of ${m[1]}` : `Row ${row}`; };

function RowList({ title, rows: all }: { title: string; rows: RowError[] }) {
  const [open, setOpen] = useState(false);
  // The same row can be refused once per sheet pass with the same reason; say it once.
  const rows = all.filter((e, i) => all.findIndex(x => x.row === e.row && x.reason === e.reason) === i);
  if (!rows.length) return null;
  const shown = open ? rows : rows.slice(0, 5);
  return (
    <div className="flex flex-col gap-1 text-meta">
      <span className="font-medium">{n(rows.length)} {title}</span>
      <ul className="m-0 pl-4 flex flex-col gap-0.5 text-[var(--color-ink-2)]">
        {shown.map((e, i) => <li key={i}>{rowLabel(e.row)}: {e.reason}</li>)}
      </ul>
      {rows.length > 5 && <Button size="sm" variant="tertiary" className="self-start" style={{ paddingLeft: 0 }} onClick={() => setOpen(o => !o)}>{open ? 'Show fewer' : `Show all ${n(rows.length)}`}</Button>}
    </div>
  );
}

function ResultView({ r, preview }: { r: Result; preview?: boolean }) {
  const TABLE: Record<string, string> = { properties: 'Buildings', owners: 'Owners', owner_contracts: 'Contracts', units: 'Units', unit_expenses: 'Monthly costs', guests: 'Guests', reservations: 'Reservations', tasks: 'Cleaning jobs', expenses: 'Expenses',
    cleaners: 'Cleaners', unit_utility_accounts: 'Utility accounts', guarantee_pool_months: 'Guarantee pool months', owner_adjustments: 'Owner adjustments and debts',
    owner_statements: 'Owner statements', statement_lines: 'Owner statement lines', payouts: 'Owner payouts', booking_payments: 'Reservation payments' };
  return (
    <div className="flex flex-col gap-2 py-3 px-3 rounded-control [border:1px_solid_var(--color-line-soft)]">
      <span className="text-copy font-semibold">{preview
        ? `Preview, nothing saved: ${n(r.created)} would be added · ${n(r.updated)} would change · ${n(r.skipped)} would be left out`
        : `${n(r.created)} added · ${n(r.updated)} updated · ${n(r.skipped)} not imported`}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-[var(--color-ink-2)]">
        {Object.entries(r.tables).map(([t, v]) => <span key={t}>{TABLE[t] ?? t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}: {n(v.created)} new, {n(v.updated)} updated</span>)}
        {r.stats && 'matched' in r.stats && <span>Matched {n(r.stats.matched)}, workbook only {n(r.stats.workbookOnly)}, HostPlatform only {n(r.stats.hostPlatformOnly)}</span>}
        {r.stats && 'statesBefore' in r.stats && <span>States written {n(r.stats.statesBefore)} ways before, {n(r.stats.statesAfter)} after; cities {n(r.stats.citiesBefore)} before, {n(r.stats.citiesAfter)} after</span>}
        {r.stats && 'statements' in r.stats && <span>{n(r.stats.statements)} statements for {n(r.stats.unitMonths)} unit-months, {n(r.stats.payouts)} paid owner payouts; {n(r.stats.creditsSettled)} credits marked as already paid in them</span>}
        {r.stats && 'pulled' in r.stats && <span>{n(r.stats.pulled)} reservations read from HostPlatform, {n(r.stats.blocks)} of them blocks (no guest)</span>}
        {r.stats && 'matchedHostPlatform' in r.stats && <span>Amounts set on {n(r.stats.matchedHostPlatform)} HostPlatform reservations, {n(r.stats.createdFromWorkbook)} added from the workbook</span>}
      </div>
      {r.notes.map(t => <p key={t} className="m-0 text-meta text-[var(--color-ink-2)]">{t}</p>)}
      <RowList title={r.errors.length === 1 ? 'row not imported (error)' : 'rows not imported (errors)'} rows={r.errors} />
      <RowList title={r.skippedRows.length === 1 ? 'row skipped on purpose' : 'rows skipped on purpose'} rows={r.skippedRows} />
      <RowList title={r.missing?.length === 1 ? 'reservation live here that HostPlatform no longer has (nothing removed; check and cancel by hand)' : 'reservations live here that HostPlatform no longer has (nothing removed; check and cancel by hand)'} rows={r.missing ?? []} />
    </div>
  );
}
