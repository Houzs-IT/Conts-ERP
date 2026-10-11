import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';
import { rm, date, dateTime, time, humanize, titleCase, monthLabel, count, plural } from '../lib/format';
import { ROLE_LABEL, CHANNEL } from '../lib/vocabulary';
import { cx } from '../lib/design-tokens';
import { Skeleton } from './States';
import Icon from './Icon';
import { Drawer } from './Dialog';
import { CATEGORY as REPAIR_CATEGORY } from './ops/OpsUi';
import { PAYER_LABEL, CATEGORY_LABEL, MODEL } from '../lib/revenueModel';
import { statusLabel, type StatusEntity } from '../lib/status';
import { CloseButton } from './CloseButton';

/* ------------------------------------------------------------------ *
 * The History panel on every detail view: who changed what and when, field by field,
 * read from the audit trail (GET /api/audit?entityTable=&entityId=). A person's change
 * shows their initials; a change made by the system (Channex, the scheduled job) or by an
 * import is marked as such so nobody mistakes it for someone's edit.
 * ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: number; actorId: string | null; actorLabel: string; actorRole: string | null; actorKind: 'person' | 'system' | 'import';
  action: string; entityTable: string; entityId: string; before: unknown; after: unknown; source: string | null; occurredAt: string;
}
interface Payload { data: HistoryEntry[]; total: number; page: number; pageSize: number; names?: Record<string, string> }

/** What happened, as a phrase after the person's name. Anything not listed reads from its code. */
const ACTION: Record<string, string> = {
  'reservation.create': 'created this reservation', 'reservation.duplicate': 'created this reservation as a copy',
  'reservation.status': 'changed the status', 'reservation.cancel': 'cancelled the reservation', 'reservation.dates': 'changed the dates',
  'reservation.details': 'changed the details', 'reservation.prepare': 'prepared the check-in', 'reservation.payment': 'recorded a payment',
  'reservation.payment_removed': 'removed a payment', 'reservation.block_released': 'released the calendar block',
  'reservation.side_effect_failed': 'hit a problem finishing a status change',
  'reservation.block': 'held these dates', 'document.issue': 'issued a document', 'document.void': 'voided a document', 'message.send': 'sent a message',
  'channex.booking_created': 'received this reservation from the channel', 'channex.booking_updated': 'received a change from the channel',
  'channex.booking_cancelled': 'received a cancellation from the channel', 'channex.booking_clash': 'found it clashes with another reservation',
  'channex.availability_failed': 'could not update the channels',
  'guest.create': 'added this guest', 'guest.update': 'edited the guest', 'guest.merge': 'merged a duplicate guest into this one', 'guest.id_revealed': 'viewed the full ID number',
  'unit.create': 'added this unit', 'unit.update': 'edited the unit', 'unit.block': 'blocked the unit', 'unit.readiness_change': 'changed readiness',
  'unit.channex_map': 'linked the unit to Channex', 'unit.channex_unmap': 'unlinked the unit from Channex', 'unit.channex_setup': 'set the unit up on Channex',
  'channel.connect': 'connected a channel', 'channel.disconnect': 'disconnected a channel', 'channex.enqueue_failed': 'could not send an update to the channels',
  'owner.create': 'added this owner', 'owner.update': 'edited the owner', 'owner.invite': 'invited the owner to the portal', 'owner.notify': 'messaged the owner', 'owner.delete': 'deleted the owner',
  'contract.create': 'created the contract', 'contract.update': 'edited the contract',
  'statement.generate': 'generated the statement', 'statement.finalise': 'marked the statement final', 'statement.send': 'sent the statement', 'statement.adjust': 'adjusted the statement',
  'payout.create': 'created the owner payout', 'payout.run': 'started an owner payout run', 'payout.processing': 'marked it processing', 'payout.paid': 'marked it paid', 'payout.failed': 'marked it failed',
  'expense.create': 'recorded the expense', 'expense.update': 'edited the expense', 'expense.delete': 'deleted the expense',
  'task.assign': 'assigned the cleaning job', 'task.assign_cleaner': 'assigned the cleaning job', 'task.start': 'started the cleaning job', 'task.complete': 'finished the cleaning job',
  'task.edit': 'edited the cleaning job', 'task.reschedule': 'moved the cleaning job', 'task.photo': 'added a photo', 'task.checklist_add': 'added a checklist item',
  'task.guest_left': 'marked the guest as left', 'task.guest_left_undo': 'undid "guest left"', 'task.remove': 'removed the cleaning job', 'task.overdue': 'marked it overdue',
  'housekeeping.create': 'created the cleaning job', 'expense.clean_charge_failed': 'could not charge for the cleaning job',
  'maintenance.create': 'reported the problem', 'maintenance.assign': 'assigned the job', 'maintenance.edit': 'edited the job', 'maintenance.start': 'started the job',
  'maintenance.end': 'finished the work', 'maintenance.complete': 'closed the job', 'maintenance.reopen': 'reopened the job',
  'maintenance.request_approval': "asked for the owner's approval", 'maintenance.approve': 'approved the quote', 'maintenance.decline': 'declined the quote',
  'maintenance.window_add': 'planned a visit', 'maintenance.window_remove': 'removed a visit', 'maintenance.photo': 'added a photo', 'maintenance.document': 'added a document',
  'maintenance.exchange': 'swapped a part', 'maintenance.block_released': 'gave the blocked nights back',
  'user.invite': 'invited this person', 'user.update': 'edited the account', 'user.reset_link': 'made a password reset link', 'user.resend_invite': 'resent the invitation',
  'user.permission_change': 'changed permissions', 'user.view_as': 'viewed the system as this person',
  'account.password_changed': 'changed the password', 'account.password_reset_completed': 'reset the password',
};

/** How a field is called on screen, and how its value is shown. */
type Kind = 'money' | 'pct' | 'date' | 'when' | 'state' | 'role' | 'channel' | 'bool' | 'name' | 'text';
const FIELD: Record<string, [string, Kind?]> = {
  state: ['Status', 'state'], status: ['Status', 'state'], readiness: ['Readiness', 'state'], reason: ['Reason'],
  checkIn: ['Check-in', 'date'], checkOut: ['Checkout', 'date'], checkInTime: ['Check-in time'], checkOutTime: ['Checkout time'],
  grossBookingValue: ['Guest total', 'money'], amount: ['Amount', 'money'], finalAmount: ['Final amount', 'money'], quotedAmount: ['Quote', 'money'],
  // vocab-ok: Net Payout to Owner is the owner report's exact wording
  netPayout: ['Net Payout to Owner', 'money'], grossSen: ['Guest total', 'money'], feeSen: ['Service fee', 'money'], managementFee: ['Operator share', 'money'],
  expensesTotal: ['Expenses', 'money'], adjustmentsTotal: ['Owner Adjustments', 'money'],
  fee: ['Operator share', 'pct'], managementFeePct: ['Operator share', 'pct'], defaultManagementFeePct: ['Default operator share', 'pct'],
  receivedOn: ['Received on', 'date'], incurredOn: ['Date', 'date'], renewsOn: ['Renews on', 'date'], startsOn: ['Starts on', 'date'],
  contractStartsOn: ['Contract starts', 'date'], contractRenewsOn: ['Contract renews', 'date'],
  startsAt: ['From', 'when'], endsAt: ['Until', 'when'], scheduledFor: ['Scheduled for', 'when'], dueAt: ['Due', 'when'], guestLeftAt: ['Guest left', 'when'], endedAt: ['Work finished', 'when'], startedAt: ['Started', 'when'],
  role: ['Role', 'role'], channel: ['Channel', 'channel'], isActive: ['Active', 'bool'], photoWaived: ['Photo waived', 'bool'], blocksUnit: ['Blocks the unit', 'bool'],
  assigneeId: ['Assigned to', 'name'], cleanerId: ['Cleaner', 'name'], managerId: ['Reports to', 'name'], unitId: ['Unit', 'name'], ownerId: ['Owner', 'name'], buildingId: ['Building', 'name'],
  movedFrom: ['Moved from', 'name'], movedTo: ['Moved to', 'name'],
  assignee: ['Assigned to'], assigneeKind: ['In-house or contractor', 'state'], chargeTo: ['Paid by', 'state'], category: ['Category', 'state'], urgency: ['Urgency', 'state'],
  fullName: ['Name'], displayName: ['Name'], email: ['Email'], phone: ['Phone'], title: ['Title'], detail: ['Details'], note: ['Note'], notes: ['Notes'], staffNotes: ['Staff notes'],
  model: ['Contract type', 'state'], period: ['Period'], kind: ['Kind', 'state'], method: ['Method', 'state'], reference: ['Reference'], externalRef: ['Booking reference'],
  listingName: ['Listing name'], unitNumber: ['Unit number'], unitCode: ['Unit code'], building: ['Building'], owner: ['Owner'], package: ['Package'], term: ['Term'],
  split: ['Split'], splitValue: ['Split value'], guaranteePeriod: ['Guarantee period'], bedrooms: ['Bedrooms'], address: ['Address'],
  ownerBankOrId: ['Owner bank or ID details'], monthlyCosts: ['Monthly costs'], tasksRemoved: ['Unstarted jobs removed'], run: ['Owner payout run'], failureReason: ['Why it failed'],
  quantity: ['Quantity'], stockOnHand: ['Left in stock'],
  employment: ['Employment', 'state'], via: ['Through', 'state'], label: ['Item'], ownerApprovalRequired: ['Needs owner approval', 'bool'], released: ['Released', 'state'],
  blockFrom: ['From', 'date'], blockTo: ['Until', 'date'], copiedFrom: ['Copied from', 'name'], otaName: ['Channel'],
  type: ['Document', 'state'], docNo: ['Document number'], voided: ['Voided', 'bool'],
  countryCode: ['Nationality'], idType: ['ID type'], idNumber: ['ID number'], dateOfBirth: ['Date of birth'], language: ['Language'],
};
const ID_TYPE: Record<string, string> = { mykad: 'MyKad', passport: 'Passport', other: 'Other ID' };
const countryLabel = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; } };
/** Kept in the record for the system's own use; nothing a person needs to read. */
const HIDDEN = new Set(['moveId', 'documentId', 'windowId', 'channexBookingId', 'statementId', 'amountSource', 'sourceTaskId', 'reservationId', 'maintenanceIssueId', 'issueId', 'paymentId', 'otaBookingId', 'clashingReservationId', 'checked', 'created', 'fields', 'hasEmail', 'hasPhone', 'overlaps']);

/** Who reported a repair, in the words the Maintenance screen uses. */
const REPORTED_BY: Record<string, string> = { guest: 'Guest', cleaner: 'Cleaner', inspection: 'Inspection', staff: 'Office' };

const labelOf = (k: string) => FIELD[k]?.[0] ?? humanize(k.replace(/([a-z])([A-Z])/g, '$1_$2'));

/** Which status vocabulary a record's state reads from, so History says what that record's own screen says. */
const STATE_OF: Record<string, StatusEntity> = {
  reservations: 'booking', units: 'readiness', owner_statements: 'statement', payouts: 'payout', tasks: 'task', maintenance_issues: 'task',
};
const ASSIGNEE_KIND: Record<string, string> = { in_house: 'In-house', contractor: 'Contractor' };

/** A stored code in the words the rest of the app uses for it; null when the field has no list of its own. */
function known(k: string, v: string, table: string): string | null {
  if (k === 'chargeTo') return PAYER_LABEL[v] ?? null;
  if (k === 'category') return (table === 'expenses' ? CATEGORY_LABEL[v] : REPAIR_CATEGORY[v] ?? CATEGORY_LABEL[v]) ?? null;
  if (k === 'assigneeKind') return ASSIGNEE_KIND[v] ?? null;
  if (k === 'model') return MODEL[v as keyof typeof MODEL]?.label ?? null;
  if (k === 'readiness') return statusLabel('readiness', v);
  if (k === 'state' || k === 'status') return statusLabel(STATE_OF[table] ?? 'task', v);
  return null;
}

function show(k: string, v: unknown, names: Record<string, string>, table = ''): string {
  if (v === null || v === undefined || v === '') return 'none';
  const kind = FIELD[k]?.[1] ?? (typeof v === 'number' && /(amount|total|payout|price|cost|deposit|rate)$/i.test(k) ? 'money' : 'text');
  if (k === 'countryCode' && typeof v === 'string' && /^[A-Z]{2}$/.test(v)) return countryLabel(v);
  if (k === 'idType' && typeof v === 'string') return ID_TYPE[v] ?? humanize(v);
  if (k === 'tags' && typeof v === 'string') return v.split(',').filter(Boolean).map(t => t === 'vip' ? 'VIP' : humanize(t)).join(', ') || 'none';
  if (typeof v === 'boolean' || kind === 'bool') return v === true || v === 1 || v === '1' ? 'Yes' : 'No';
  if (kind === 'money' && typeof v === 'number') return rm(v);
  if (kind === 'pct' && (typeof v === 'number' || typeof v === 'string') && v !== '') return `${Number(v)}%`;
  if (kind === 'name' && typeof v === 'string') return names[v] ?? 'a record no longer here';
  if (kind === 'role' && typeof v === 'string') return ROLE_LABEL[v] ?? humanize(v);
  if (k === 'source' && typeof v === 'string' && REPORTED_BY[v]) return REPORTED_BY[v];
  if (kind === 'channel' && typeof v === 'string') return CHANNEL[v as keyof typeof CHANNEL]?.label ?? humanize(v);
  if (typeof v === 'string') { const word = known(k, v, table); if (word) return word; }
  if (kind === 'state' && typeof v === 'string') return humanize(v);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}$/.test(v)) return monthLabel(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return date(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return dateTime(v);
    if (kind === 'text' && /^[a-z]+(_[a-z]+)+$/.test(v)) return humanize(v);
    return v.length > 160 ? `${v.slice(0, 160)}...` : (k === 'owner' || k === 'displayName' ? titleCase(v) : v);
  }
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') || 'none';
  if (typeof v === 'number') return count(v);
  return JSON.stringify(v);
}

type Line = { key: string; label: string; from?: string; to: string };

/** Field-by-field lines: a changed field shows old -> new; a field only in "after" shows its value. */
export function historyLines(e: Pick<HistoryEntry, 'before' | 'after'> & { entityTable?: string }, names: Record<string, string> = {}): Line[] {
  const b = (e.before && typeof e.before === 'object' && !Array.isArray(e.before) ? e.before : {}) as Record<string, unknown>;
  const a = (e.after && typeof e.after === 'object' && !Array.isArray(e.after) ? e.after : {}) as Record<string, unknown>;
  const table = e.entityTable ?? '';
  const out: Line[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (HIDDEN.has(k)) continue;
    const inBefore = k in b, inAfter = k in a;
    if (inBefore && inAfter) {
      if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
      out.push({ key: k, label: labelOf(k), from: show(k, b[k], names, table), to: show(k, a[k], names, table) });
    } else if (inAfter) {
      if (a[k] === null || a[k] === undefined || a[k] === '' || a[k] === false) continue;
      out.push({ key: k, label: labelOf(k), to: show(k, a[k], names, table) });
    } else {
      out.push({ key: k, label: labelOf(k), from: show(k, b[k], names, table), to: 'removed' });
    }
  }
  return out;
}

export function actionPhrase(action: string) {
  if (ACTION[action]) return ACTION[action];
  const tail = action.split('.').slice(1).join(' ') || action;
  return humanize(tail).toLowerCase();
}

const SOURCE: Record<string, string> = { field_app: 'Field app', owner_portal: 'Owner portal', import: 'Import', system: 'Automatic', cron: 'Automatic' };
const tagOf = (e: HistoryEntry) => e.actorKind === 'import' ? 'Import' : e.actorKind === 'system' ? 'Automatic' : SOURCE[e.source ?? ''] ?? null;

/** One person's burst of saves on one record, oldest first: several quick edits read as one entry, not a stack of cards. */
interface Run { key: number; entries: HistoryEntry[] }
const RUN_WINDOW_MS = 2 * 60_000;
const sameHand = (a: HistoryEntry, b: HistoryEntry) =>
  a.actorKind === b.actorKind && (a.actorId ?? a.actorLabel) === (b.actorId ?? b.actorLabel)
  && a.entityTable === b.entityTable && a.entityId === b.entityId && tagOf(a) === tagOf(b);

/** Rows arrive newest first; each run is keyed by its newest row so it keeps its identity as older pages load. */
export function groupRuns(rows: HistoryEntry[]): Run[] {
  const out: Run[] = [];
  for (const e of rows) {
    const run = out[out.length - 1];
    const oldest = run?.entries[0];
    if (run && oldest && sameHand(oldest, e) && Date.parse(oldest.occurredAt) - Date.parse(e.occurredAt) <= RUN_WINDOW_MS) run.entries.unshift(e);
    else out.push({ key: e.id, entries: [e] });
  }
  return out;
}

const joinPhrases = (p: string[]) => p.length <= 1 ? p.join('') : `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
const ROWS_SHOWN = 5;

function Dot({ kind, label }: { kind: HistoryEntry['actorKind']; label: string }) {
  if (kind === 'person') {
    const initials = label.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
    return <span aria-hidden className="relative z-[1] w-6 h-6 flex-none rounded-full bg-muted text-ink grid place-items-center text-caption leading-none font-semibold [box-shadow:0_0_0_3px_var(--color-card)]">{initials}</span>;
  }
  return (
    <span aria-hidden className="relative z-[1] w-6 h-6 flex-none rounded-full border border-dashed border-line bg-card text-muted-ink grid place-items-center [box-shadow:0_0_0_3px_var(--color-card)]">
      <Icon name={kind === 'import' ? 'FileInput' : 'Cog'} size="sm" />
    </span>
  );
}

/** A row of the timeline: the dot on the rail, then the sentence and its muted meta line underneath. */
function Rail({ dot, last, children }: { dot: ReactNode; last: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3 px-5 min-w-0">
      <div className="flex flex-col items-center flex-none pt-[1px]">
        {dot}
        {!last && <span aria-hidden className="w-px flex-1 bg-line-soft" />}
      </div>
      <div className={cx('flex flex-col min-w-0 flex-1', last ? 'pb-1' : 'pb-4')}>{children}</div>
    </li>
  );
}

function Changes({ lines }: { lines: Line[] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(72px,max-content)_1fr] gap-x-3 gap-y-[2px] text-meta">
      {lines.map((l, i) => (
        <div key={`${l.key}-${i}`} className="contents">
          <dt className="text-muted-ink">{l.label}</dt>
          <dd className="m-0 text-ink min-w-0 [overflow-wrap:anywhere]">
            {l.from !== undefined && <><span className="text-muted-ink">{l.from}</span><span aria-label="changed to" className="text-faint px-1">→</span></>}
            <span>{l.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function HistoryRun({ run, names, last = false }: { run: Run; names: Record<string, string>; last?: boolean }) {
  const [all, setAll] = useState(false);
  const head = run.entries[run.entries.length - 1];
  const first = run.entries[0];
  const phrases = run.entries.map(e => actionPhrase(e.action)).filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
  const mixed = new Set(phrases).size > 1;
  const blocks = run.entries.map(e => ({ e, phrase: actionPhrase(e.action), lines: historyLines(e, names) })).filter(b => b.lines.length > 0);
  const hidden = blocks.reduce((n, b) => n + Math.max(0, b.lines.length - ROWS_SHOWN), 0);
  const shown = all ? blocks : blocks.map(b => ({ ...b, lines: b.lines.slice(0, ROWS_SHOWN) }));
  const tag = tagOf(head);
  const role = head.actorKind === 'person' && head.actorRole ? ROLE_LABEL[head.actorRole] ?? humanize(head.actorRole) : null;
  const span = first.occurredAt !== head.occurredAt ? `${dateTime(first.occurredAt)} to ${time(head.occurredAt)}` : dateTime(head.occurredAt);
  return (
    <Rail last={last} dot={<Dot kind={head.actorKind} label={head.actorLabel} />}>
      <span className="text-copy text-ink [overflow-wrap:anywhere]">
        <strong className="font-semibold">{head.actorKind === 'person' ? head.actorLabel : head.actorLabel || 'System'}</strong>{' '}
        <span className={cx(head.actorKind !== 'person' && 'text-muted-ink')}>{joinPhrases(phrases)}</span>
      </span>
      <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">
        {[role, tag].filter(Boolean).map(x => <span key={x}>{x} · </span>)}
        <time dateTime={head.occurredAt} title={span}>{dateTime(head.occurredAt)}</time>
      </span>
      {shown.length > 0 && (
        <div className="mt-[6px] flex flex-col gap-[6px]">
          {shown.map((b, i) => (
            <div key={b.e.id} className="flex flex-col gap-[2px]">
              {mixed && b.phrase !== shown[i - 1]?.phrase && <span className="text-caption font-medium text-muted-ink">{b.phrase.replace(/^./, c => c.toUpperCase())}</span>}
              <Changes lines={b.lines} />
            </div>
          ))}
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(v => !v)}
              className="self-start p-0 border-0 bg-transparent text-meta font-medium text-accent cursor-pointer hover:underline">
              {all ? 'Show less' : `Show ${count(hidden)} more`}
            </button>
          )}
        </div>
      )}
    </Rail>
  );
}

/**
 * Drop into any detail view. `entity` is the table, `id` the record; `also` adds more records to the same history
 * (a unit's contract, say). `refreshKey` reloads it after a save. `origin` adds the record's first appearance when
 * no create entry exists (records brought in by an import before every change was recorded).
 */
export function RecordHistory({ entity, id, also, title = 'History', bare = false, pageSize = 20, refreshKey, origin }: {
  entity: string; id: string; also?: [string, string][]; title?: string; bare?: boolean; pageSize?: number; refreshKey?: unknown;
  origin?: { at: string; label: string };
}) {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alsoParam = (also ?? []).map(([t, i]) => `${t}:${i}`).join(',');

  useEffect(() => { setPage(1); }, [entity, id, alsoParam, refreshKey]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get<Payload>('/audit', { entityTable: entity, entityId: id, also: alsoParam || undefined, page, pageSize })
      .then(r => {
        if (!live) return;
        setRows(prev => page === 1 ? r.data : [...prev, ...r.data.filter(x => !prev.some(p => p.id === x.id))]);
        setNames(prev => ({ ...(page === 1 ? {} : prev), ...(r.names ?? {}) }));
        setTotal(r.total); setError(null);
      })
      .catch(e => { if (live) setError(errorMessage(e, 'The history could not load. Check your connection and try again.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [entity, id, alsoParam, page, pageSize, refreshKey]);

  const first = loading && page === 1 && rows.length === 0;
  const done = rows.length >= total;
  const runs = useMemo(() => groupRuns(rows), [rows]);
  const showOrigin = !!origin && done && !error && !first;
  const body = (
    <>
      {!bare && (
        <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-heading font-semibold">{title}</span>
          {total > 0 && <span className="text-meta text-muted-ink">{plural(total, 'change')}</span>}
        </div>
      )}
      {first && <div className="py-4 px-5 flex flex-col gap-3" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} height={34} />)}</div>}
      {error && <div className="py-4 px-5 text-copy text-danger" role="alert">{error}</div>}
      {!first && !error && rows.length === 0 && !origin && <div className="py-4 px-5 text-copy text-muted-ink">No changes recorded yet. Every edit from now on shows here, with who made it.</div>}
      {(runs.length > 0 || showOrigin) && (
        <ul className="list-none m-0 py-3 px-0">
          {runs.map((r, i) => <HistoryRun key={r.key} run={r} names={names} last={i === runs.length - 1 && !showOrigin} />)}
          {showOrigin && origin && (
            <Rail last dot={<Dot kind="import" label="" />}>
              <span className="text-copy text-muted-ink">{origin.label}</span>
              <time dateTime={origin.at} title={dateTime(origin.at)} className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{dateTime(origin.at)}</time>
            </Rail>
          )}
        </ul>
      )}
      {!done && !error && (
        <div className="py-3 px-5 [border-top:1px_solid_var(--color-line-soft)] flex items-center justify-between gap-3">
          <span className="text-meta text-muted-ink">Showing {count(rows.length)} of {count(total)}</span>
          <button type="button" onClick={() => setPage(p => p + 1)} disabled={loading}
            className="h-9 px-3 rounded-control border border-solid border-line bg-card text-copy text-ink cursor-pointer hover:bg-muted disabled:opacity-60 disabled:cursor-default">
            {loading ? 'Loading...' : 'Show older'}
          </button>
        </div>
      )}
    </>
  );
  if (bare) return <section aria-label={title}>{body}</section>;
  return <section aria-label={title} className="bg-card border border-solid border-line rounded-card overflow-hidden flex-none">{body}</section>;
}

/** A folded "History" for forms and drawers with little room: loads only when opened. */
export function HistoryDisclosure({ entity, id, also, refreshKey, label = 'History' }: {
  entity: string; id: string; also?: [string, string][]; refreshKey?: unknown; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-card border border-solid border-line bg-card overflow-hidden group">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none py-3 px-4 flex items-center justify-between gap-3 text-copy font-medium text-ink hover:bg-muted">
        <span className="flex items-center gap-2"><Icon name="History" size="sm" />{label}</span>
        <Icon name="ChevronDown" size="sm" style={{ transition: 'transform 120ms ease-out' }} />
      </summary>
      {open && <div className="[border-top:1px_solid_var(--color-line-soft)]"><RecordHistory entity={entity} id={id} also={also} refreshKey={refreshKey} bare pageSize={10} title={label} /></div>}
    </details>
  );
}

/** A record's history in a side drawer, for lists whose rows have no detail view of their own (payouts, expenses). */
export function HistoryDrawer({ target, onClose }: {
  target: { entity: string; id: string; title: string; sub?: string; also?: [string, string][] } | null; onClose: () => void;
}) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, onClose]);
  return (
    <Drawer open={!!target} onClose={onClose} width={480}>
      {target && <>
        <div className="flex items-start justify-between gap-3 p-5 [border-bottom:1px_solid_var(--color-line)] sticky top-0 bg-card z-[1]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">History</span>
            <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{target.title}</h2>
            {target.sub && <span className="text-meta text-muted-ink">{target.sub}</span>}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <RecordHistory key={`${target.entity}:${target.id}`} entity={target.entity} id={target.id} also={target.also} bare title={`History of ${target.title}`} />
      </>}
    </Drawer>
  );
}

export default RecordHistory;
