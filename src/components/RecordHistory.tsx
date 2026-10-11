import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { rm, date, dateTime, relative, humanize, titleCase, monthLabel, count, plural, time, weekdayDate, year } from '../lib/format';
import { ROLE_LABEL, CHANNEL, stateLabel } from '../lib/vocabulary';
import { cx } from '../lib/design-tokens';
import { Skeleton } from './States';
import Icon from './Icon';
import { Drawer } from './Dialog';

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
  'reservation.create': 'created this booking', 'reservation.duplicate': 'created this booking as a copy',
  'reservation.status': 'changed the status', 'reservation.cancel': 'cancelled the booking', 'reservation.dates': 'changed the dates',
  'reservation.details': 'changed the details', 'reservation.prepare': 'prepared the arrival', 'reservation.payment': 'recorded a payment',
  'reservation.payment_removed': 'removed a payment', 'reservation.block_released': 'released the calendar block',
  'reservation.side_effect_failed': 'hit a problem finishing a status change',
  'reservation.block': 'held these dates', 'document.issue': 'issued a document', 'document.void': 'voided a document', 'message.send': 'sent a message',
  'channex.booking_created': 'received this booking from the booking site', 'channex.booking_updated': 'received a change from the booking site',
  'channex.booking_cancelled': 'received a cancellation from the booking site', 'channex.booking_clash': 'found it clashes with another stay',
  'channex.availability_failed': 'could not update the booking sites',
  'guest.create': 'added this guest', 'guest.update': 'edited the guest', 'guest.merge': 'merged a duplicate guest into this one', 'guest.id_revealed': 'viewed the full ID number',
  'unit.create': 'added this unit', 'unit.update': 'edited the unit', 'unit.block': 'blocked the unit', 'unit.readiness_change': 'changed readiness',
  'unit.channex_map': 'linked the unit to Channex', 'unit.channex_unmap': 'unlinked the unit from Channex', 'unit.channex_setup': 'set the unit up on Channex',
  'channel.connect': 'connected a booking site', 'channel.disconnect': 'disconnected a booking site', 'channex.enqueue_failed': 'could not queue a booking-site update',
  'owner.create': 'added this owner', 'owner.update': 'edited the owner', 'owner.invite': 'invited the owner to the portal', 'owner.notify': 'messaged the owner', 'owner.delete': 'deleted the owner',
  'contract.create': 'created the contract', 'contract.update': 'edited the contract',
  'statement.generate': 'generated the statement', 'statement.finalise': 'finalised the statement', 'statement.send': 'sent the statement', 'statement.adjust': 'adjusted the statement',
  'payout.create': 'created the payout', 'payout.run': 'started a payout run', 'payout.processing': 'marked it processing', 'payout.paid': 'marked it paid', 'payout.failed': 'marked it failed',
  'expense.create': 'recorded the expense', 'expense.update': 'edited the expense', 'expense.delete': 'deleted the expense',
  'task.assign': 'assigned the cleaning job', 'task.assign_cleaner': 'assigned the cleaning job', 'task.cleaners': 'changed the cleaners',
  'task.start': 'started cleaning', 'task.complete': 'finished the cleaning job',
  'task.edit': 'edited the cleaning job', 'task.reschedule': 'moved the cleaning job', 'task.photo': 'added a photo', 'task.checklist_add': 'added a checklist item',
  'task.guest_left': 'marked the guest as left', 'task.guest_left_undo': 'undid "guest left"', 'task.remove': 'removed the cleaning job', 'task.overdue': 'marked it overdue',
  'housekeeping.create': 'created the cleaning job', 'expense.clean_charge_failed': 'could not charge the cleaning job',
  'reservation.expected_arrival': 'recorded the expected arrival',
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
  checkIn: ['Check-in', 'date'], checkOut: ['Check-out', 'date'], checkInTime: ['Check-in time'], checkOutTime: ['Check-out time'],
  grossBookingValue: ['Booking total', 'money'], amount: ['Amount', 'money'], finalAmount: ['Final amount', 'money'], quotedAmount: ['Quote', 'money'],
  netPayout: ['Net payout', 'money'], grossSen: ['Booking total', 'money'], feeSen: ['Site fee', 'money'], managementFee: ['Management fee', 'money'],
  expensesTotal: ['Costs', 'money'], adjustmentsTotal: ['Adjustments', 'money'],
  fee: ['Management fee', 'pct'], managementFeePct: ['Management fee', 'pct'], defaultManagementFeePct: ['Default management fee', 'pct'],
  receivedOn: ['Received on', 'date'], incurredOn: ['Date', 'date'], renewsOn: ['Renews on', 'date'], startsOn: ['Starts on', 'date'],
  contractStartsOn: ['Contract starts', 'date'], contractRenewsOn: ['Contract renews', 'date'],
  startsAt: ['From', 'when'], endsAt: ['Until', 'when'], scheduledFor: ['Scheduled for', 'when'], dueAt: ['Due', 'when'], guestLeftAt: ['Guest left', 'when'], endedAt: ['Work finished', 'when'], startedAt: ['Started', 'when'],
  role: ['Role', 'role'], channel: ['Channel', 'channel'], isActive: ['Active', 'bool'], photoWaived: ['Photo waived', 'bool'], blocksUnit: ['Blocks the unit', 'bool'],
  assigneeId: ['Assigned to', 'name'], cleanerId: ['Cleaner', 'name'], cleaners: ['Cleaners'], expectedArrival: ['Expected arrival'], cleaner: ['Cleaner'], mode: ['How', 'state'], managerId: ['Reports to', 'name'], unitId: ['Unit', 'name'], ownerId: ['Owner', 'name'], buildingId: ['Building', 'name'],
  movedFrom: ['Moved from', 'name'], movedTo: ['Moved to', 'name'],
  assignee: ['Assigned to'], assigneeKind: ['In-house or contractor', 'state'], chargeTo: ['Paid by', 'state'], category: ['Category', 'state'], urgency: ['Urgency', 'state'],
  fullName: ['Name'], displayName: ['Name'], email: ['Email'], phone: ['Phone'], title: ['Title'], detail: ['Details'], note: ['Note'], notes: ['Notes'], staffNotes: ['Staff notes'],
  model: ['Contract type', 'state'], period: ['Period'], kind: ['Kind', 'state'], method: ['Method', 'state'], reference: ['Reference'], externalRef: ['Booking reference'],
  listingName: ['Listing name'], unitNumber: ['Unit number'], unitCode: ['Unit code'], building: ['Building'], owner: ['Owner'], package: ['Package'], term: ['Term'],
  split: ['Split'], splitValue: ['Split value'], guaranteePeriod: ['Guarantee period'], bedrooms: ['Bedrooms'], address: ['Address'],
  ownerBankOrId: ['Owner bank or ID details'], monthlyCosts: ['Monthly costs'], tasksRemoved: ['Unstarted tasks removed'], run: ['Payout run'], failureReason: ['Why it failed'],
  quantity: ['Quantity'], stockOnHand: ['Left in stock'],
  employment: ['Employment', 'state'], via: ['Through', 'state'], label: ['Item'], ownerApprovalRequired: ['Needs owner approval', 'bool'], released: ['Released', 'state'],
  blockFrom: ['From', 'date'], blockTo: ['Until', 'date'], copiedFrom: ['Copied from', 'name'], otaName: ['Booking site'],
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

function show(k: string, v: unknown, names: Record<string, string>): string {
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
  if (kind === 'state' && typeof v === 'string') return k === 'state' || k === 'status' ? stateLabel('task', v) : humanize(v);
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
export function historyLines(e: Pick<HistoryEntry, 'before' | 'after'>, names: Record<string, string> = {}): Line[] {
  const b = (e.before && typeof e.before === 'object' && !Array.isArray(e.before) ? e.before : {}) as Record<string, unknown>;
  const a = (e.after && typeof e.after === 'object' && !Array.isArray(e.after) ? e.after : {}) as Record<string, unknown>;
  const out: Line[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (HIDDEN.has(k)) continue;
    const inBefore = k in b, inAfter = k in a;
    if (inBefore && inAfter) {
      if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
      out.push({ key: k, label: labelOf(k), from: show(k, b[k], names), to: show(k, a[k], names) });
    } else if (inAfter) {
      if (a[k] === null || a[k] === undefined || a[k] === '' || a[k] === false) continue;
      out.push({ key: k, label: labelOf(k), to: show(k, a[k], names) });
    } else {
      out.push({ key: k, label: labelOf(k), from: show(k, b[k], names), to: 'removed' });
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

/** A record being created (or first brought in): its field values are its starting point, not changes. */
const isCreation = (e: Pick<HistoryEntry, 'action' | 'before'>) =>
  /\.(create|invite|duplicate|block|booking_created)$/.test(e.action) || e.before == null;

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * One event on one line: "14:04 · Lim Wei Siang · Marked the guest as left", then only what changed, inline
 * ("Status: Guest still in -> Guest out"). A creation is one line; its starting values open on a click.
 * Borrowed from Hookka (diff only the fields that changed, skip noise) and Houzs (old value struck, new value plain,
 * no "from" on creation, details folded until asked for).
 */
export function HistoryItem({ e, names }: { e: HistoryEntry; names: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const lines = historyLines(e, names);
  const created = isCreation(e);
  const changes = created ? [] : lines.filter(l => l.from !== undefined);
  const extra = created ? lines : lines.filter(l => l.from === undefined);
  const tag = e.actorKind === 'import' ? 'Import' : e.actorKind === 'system' ? 'Automatic' : SOURCE[e.source ?? ''] ?? null;
  const who = e.actorKind === 'person' ? e.actorLabel : e.actorLabel || 'System';
  return (
    <li className="py-1.5 px-4 min-w-0 text-meta leading-[18px]">
      <div className="flex items-baseline gap-x-1.5 gap-y-0.5 flex-wrap min-w-0">
        <time dateTime={e.occurredAt} title={dateTime(e.occurredAt)} className="flex-none w-10 text-muted-ink [font-variant-numeric:tabular-nums]">{time(e.occurredAt)}</time>
        <span className={cx('font-semibold [overflow-wrap:anywhere]', e.actorKind !== 'person' ? 'text-muted-ink' : 'text-ink')}
          title={e.actorKind === 'person' && e.actorRole ? ROLE_LABEL[e.actorRole] ?? humanize(e.actorRole) : undefined}>{who}</span>
        <span aria-hidden className="text-faint">·</span>
        <span className="text-ink [overflow-wrap:anywhere]">{capital(actionPhrase(e.action))}</span>
        {tag && <span className="text-caption font-medium leading-[16px] whitespace-nowrap px-1.5 rounded-pill bg-muted text-muted-ink">{tag}</span>}
        {extra.length > 0 && (
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
            className="p-0 border-none bg-transparent cursor-pointer font-sans text-meta text-[var(--color-text-accent)] hover:underline underline-offset-2">
            {open ? 'Hide details' : created ? 'Details' : plural(extra.length, 'more detail')}
          </button>
        )}
      </div>
      {changes.length > 0 && (
        <div className="pl-[46px] flex flex-col">
          {changes.map(l => (
            <span key={l.key} className="min-w-0 [overflow-wrap:anywhere]">
              <span className="text-muted-ink">{l.label}: </span>
              <span className="text-muted-ink line-through decoration-1">{l.from}</span>
              <span aria-label="changed to" className="text-faint px-1">-&gt;</span>
              <span className="text-ink font-medium">{l.to}</span>
            </span>
          ))}
        </div>
      )}
      {open && extra.length > 0 && (
        <dl className="m-0 mt-0.5 ml-[46px] grid grid-cols-[minmax(80px,max-content)_1fr] gap-x-3 gap-y-0.5 text-meta">
          {extra.map(l => (
            <div key={l.key} className="contents">
              <dt className="text-muted-ink">{l.label}</dt>
              <dd className="m-0 text-ink min-w-0 [overflow-wrap:anywhere]">{l.to}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** Events grouped under one heading per day, newest first. */
function Timeline({ rows, names }: { rows: HistoryEntry[]; names: Record<string, string> }) {
  const days: { day: string; items: HistoryEntry[] }[] = [];
  for (const e of rows) {
    const d = date(e.occurredAt);
    if (days.length && days[days.length - 1].day === d) days[days.length - 1].items.push(e);
    else days.push({ day: d, items: [e] });
  }
  return (
    <div className="flex flex-col py-1">
      {days.map(g => (
        <section key={g.day} aria-label={g.day}>
          <h4 className="m-0 px-4 pt-2 pb-0.5 text-caption font-semibold uppercase tracking-[0.05em] text-muted-ink">{weekdayDate(g.items[0].occurredAt)} {year(g.items[0].occurredAt)}</h4>
          <ul className="list-none m-0 p-0">{g.items.map(e => <HistoryItem key={e.id} e={e} names={names} />)}</ul>
        </section>
      ))}
    </div>
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
  const body = (
    <>
      {!bare && (
        <div className="py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-heading font-semibold">{title}</span>
          {total > 0 && <span className="text-meta text-muted-ink">{plural(total, 'change')}</span>}
        </div>
      )}
      {first && <div className="py-3 px-4 flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} height={18} />)}</div>}
      {error && <div className="py-3 px-4 text-copy text-danger" role="alert">{error} This does not mean nothing changed.</div>}
      {!first && !error && rows.length === 0 && !origin && <div className="py-3 px-4 text-meta text-muted-ink">No changes recorded yet. Every edit from now on shows here, with who made it.</div>}
      {rows.length > 0 && (
        <Timeline rows={rows} names={names} />
      )}
      {origin && done && !error && !first && (
        <div className="flex gap-2 py-2 px-4 items-center text-meta [border-top:1px_solid_var(--color-line-soft)]">
          <Icon name="FileInput" size="sm" color="var(--color-text-muted)" />
          <span className="text-muted-ink flex-1 min-w-0">{origin.label}</span>
          <span className="text-meta text-muted-ink whitespace-nowrap" title={dateTime(origin.at)}>{relative(origin.at)}</span>
        </div>
      )}
      {!done && !error && (
        <div className="py-2 px-4 [border-top:1px_solid_var(--color-line-soft)] flex items-center justify-between gap-3">
          <span className="text-meta text-muted-ink">Showing {count(rows.length)} of {count(total)}</span>
          <button type="button" onClick={() => setPage(p => p + 1)} disabled={loading}
            className="h-8 px-3 rounded-control border border-solid border-line bg-card text-meta text-ink cursor-pointer hover:bg-muted disabled:opacity-60 disabled:cursor-default">
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
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none py-2.5 px-4 flex items-center justify-between gap-3 text-copy font-medium text-ink hover:bg-muted">
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
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 flex-none grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer hover:bg-muted">
            <Icon name="X" size="sm" />
          </button>
        </div>
        <RecordHistory key={`${target.entity}:${target.id}`} entity={target.entity} id={target.id} also={target.also} bare title={`History of ${target.title}`} />
      </>}
    </Drawer>
  );
}

export default RecordHistory;
