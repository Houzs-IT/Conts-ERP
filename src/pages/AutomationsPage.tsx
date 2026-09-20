import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { Drawer } from '../components/Dialog';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/* ------------------------------------------------------------------ model */

type GroupKey =
  | 'new_booking' | 'before_arrival' | 'stay_departure'
  | 'owner_finance' | 'owner_approvals'
  | 'ops_alerts' | 'field' | 'account';

type Audience = 'guest' | 'owner' | 'staff' | 'field' | 'account';
type Delivery = 'transactional' | 'opt_out';
type QuietHours = 'queue' | 'override' | 'always';

interface Rule {
  id: string;
  name: string;
  template: string;
  group: GroupKey;
  /** Technical trigger, straight from notifications.md. */
  trigger: string;
  /** Human timing / offset. */
  timing: string;
  channels: string[];
  /** What the message needs to render — the data contract, not the body. */
  needs: string;
  /** Representative template preview (see summary note). */
  preview: string;
  delivery: Delivery;
  quietHours: QuietHours;
  isActive: boolean;
}

interface Payload {
  data: Rule[];
  quietHours: { from: string; to: string; timezone: string; note: string };
  generatedAt: string;
}

const GROUPS: { key: GroupKey; label: string; icon: string; audience: Audience; desc: string }[] = [
  { key: 'new_booking',     label: 'New booking',                 icon: 'CalendarPlus', audience: 'guest',   desc: 'When a reservation is confirmed or cancelled.' },
  { key: 'before_arrival',  label: 'Before arrival',              icon: 'DoorOpen',     audience: 'guest',   desc: 'The run-up to check-in.' },
  { key: 'stay_departure',  label: 'Stay and departure',          icon: 'LogOut',       audience: 'guest',   desc: 'Check-out and the review that follows.' },
  { key: 'owner_finance',   label: 'Owner statements and payouts',icon: 'Receipt',      audience: 'owner',   desc: 'Money leaving for the owner.' },
  { key: 'owner_approvals', label: 'Owner approvals and blocks',  icon: 'BadgeCheck',   audience: 'owner',   desc: 'Decisions and disruptions an owner should see.' },
  { key: 'ops_alerts',      label: 'Operations alerts',           icon: 'Bell',         audience: 'staff',   desc: 'Internal nudges that keep the day on track.' },
  { key: 'field',           label: 'Field app',                   icon: 'Smartphone',   audience: 'field',   desc: 'Push to housekeepers and technicians. Never financial.' },
  { key: 'account',         label: 'Account and security',        icon: 'ShieldCheck',  audience: 'account', desc: 'Sign-in and account safety.' },
];

const AUDIENCE_LABEL: Record<Audience, string> = {
  guest: 'Guest', owner: 'Owner', staff: 'Operations', field: 'Field crew', account: 'Account',
};

const QH_LABEL: Record<QuietHours, { label: string; tone: Tone }> = {
  queue:    { label: 'Queues to 08:00',            tone: 'neutral' },
  override: { label: 'Overrides quiet hours',      tone: 'warning' },
  always:   { label: 'Not subject to quiet hours', tone: 'neutral' },
};

const DELIVERY_LABEL: Record<Delivery, string> = {
  transactional: 'Transactional · cannot be opted out',
  opt_out: 'Opt-out · recipient may unsubscribe',
};

/* --------------------------------------------------------------- fallback */

const FALLBACK: Payload = {
  generatedAt: '',
  quietHours: {
    from: '22:00', to: '08:00', timezone: 'Asia/Kuala_Lumpur',
    note: 'Non-urgent guest and owner messages queue until 08:00. Check-in risk and payout failure override.',
  },
  data: [
    // New booking
    { id: 'guest.booking_confirmed', name: 'Booking confirmed', template: 'guest.booking_confirmed', group: 'new_booking',
      trigger: 'reservation.state → confirmed', timing: 'Immediate', channels: ['Email', 'WhatsApp'],
      needs: 'Guest name, property, unit, dates, nights, total, contact',
      preview: 'Hi {guest}, your booking at {property} {unit} is confirmed for {checkIn}–{checkOut} ({nights}). Total {total}. We are on WhatsApp if you need anything.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'guest.cancellation', name: 'Booking cancelled', template: 'guest.cancellation', group: 'new_booking',
      trigger: 'reservation.state → cancelled', timing: 'Immediate', channels: ['Email'],
      needs: 'Refund position, reason, contact',
      preview: 'Hi {guest}, your booking at {property} {unit} for {dates} has been cancelled. {refundPosition} Reply here and we will help.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },

    // Before arrival
    { id: 'guest.pre_arrival', name: 'Pre-arrival details', template: 'guest.pre_arrival', group: 'before_arrival',
      trigger: 'reservation.check_in approaching', timing: '48 hours before check-in', channels: ['Email', 'WhatsApp'],
      needs: 'Check-in window, address, parking note',
      preview: 'Your stay at {property} {unit} starts {checkIn}. Check-in from {checkInTime}. Address: {address}. Parking: {parkingNote}.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'guest.access_details', name: 'Access details', template: 'guest.access_details', group: 'before_arrival',
      trigger: 'unit.readiness = ready AND check-in approaching', timing: '2 hours before check-in, never earlier', channels: ['WhatsApp'],
      needs: 'Access instruction, door code, wifi. Code rotates after the stay',
      preview: 'You are all set for {property} {unit}. Door code {doorCode}, wifi {wifiName} / {wifiPass}. {accessInstruction}',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'guest.checkin_delayed', name: 'Check-in delayed', template: 'guest.checkin_delayed', group: 'before_arrival',
      trigger: 'turnover task overdue past check-in time', timing: 'On breach', channels: ['WhatsApp'],
      needs: 'New expected time, apology, contact. Sent by a human, drafted by the system',
      preview: 'Apologies {guest} — {unit} needs a little longer. New check-in time is {newTime}. Call us on {contact} any time.',
      delivery: 'transactional', quietHours: 'override', isActive: false },

    // Stay and departure
    { id: 'guest.checkout_reminder', name: 'Check-out reminder', template: 'guest.checkout_reminder', group: 'stay_departure',
      trigger: 'reservation.check_out approaching', timing: '12 hours before check-out', channels: ['WhatsApp'],
      needs: 'Check-out time, key return, late check-out option',
      preview: 'Check-out at {property} {unit} is tomorrow by {checkOutTime}. Leave keys in the lockbox. Need a late check-out? Just ask.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'guest.review_request', name: 'Review request', template: 'guest.review_request', group: 'stay_departure',
      trigger: 'reservation.state → checked_out', timing: '24 hours after check-out', channels: ['Email', 'Channel API'],
      needs: 'Channel review link',
      preview: 'Thanks for staying at {property} {unit}, {guest}. If it felt like home, a quick review helps a lot: {reviewLink}',
      delivery: 'opt_out', quietHours: 'queue', isActive: true },

    // Owner statements and payouts
    { id: 'owner.statement_ready', name: 'Statement ready', template: 'owner.statement_ready', group: 'owner_finance',
      trigger: 'statement.state → sent', timing: 'On send', channels: ['Email', 'Portal'],
      needs: 'Period, net payout, portal link, PDF',
      preview: 'Your {period} statement for {unit} is ready. Net payout {netPayout}. View it in your portal: {portalLink}',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'owner.payout_paid', name: 'Payout paid', template: 'owner.payout_paid', group: 'owner_finance',
      trigger: 'payout.state → paid', timing: 'Immediate', channels: ['Email', 'Portal'],
      needs: 'Amount, bank last 4, value date',
      preview: 'Payout of {amount} for {period} has been transferred to {bank} ••••{last4}, value date {valueDate}.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'owner.payout_failed', name: 'Payout failed', template: 'owner.payout_failed', group: 'owner_finance',
      trigger: 'payout.state → failed', timing: 'Immediate', channels: ['Email', 'Phone call task'],
      needs: 'Amount, reason, next step. Also creates an internal task',
      preview: 'We could not complete your {amount} payout for {period}: {reason}. We are on it and will call you shortly.',
      delivery: 'transactional', quietHours: 'override', isActive: true },
    { id: 'owner.monthly_summary', name: 'Monthly summary', template: 'owner.monthly_summary', group: 'owner_finance',
      trigger: 'period close', timing: '1st of the month', channels: ['Email'],
      needs: 'Occupancy, ADR, rating, upcoming bookings',
      preview: 'Your {period} summary for {unit}: occupancy {occupancy}, ADR {adr}, rating {rating}. {upcomingCount} bookings ahead.',
      delivery: 'opt_out', quietHours: 'queue', isActive: true },

    // Owner approvals and blocks
    { id: 'owner.approval_required', name: 'Approval required', template: 'owner.approval_required', group: 'owner_approvals',
      trigger: 'maintenance_issue.owner_approval_required', timing: 'Immediate', channels: ['Email', 'Portal'],
      needs: 'Title, quote, consequence of declining',
      preview: '{unit} needs {title}. Quote {amount}. If it is not approved, {consequence}. Approve in your portal: {portalLink}',
      delivery: 'transactional', quietHours: 'queue', isActive: true },
    { id: 'owner.approval_reminder', name: 'Approval reminder', template: 'owner.approval_reminder', group: 'owner_approvals',
      trigger: 'approval outstanding', timing: '48 hours, then 5 days', channels: ['Email'],
      needs: 'Same, plus the revenue at risk if the unit is blocked',
      preview: 'Reminder: {title} on {unit} is awaiting your approval. Revenue at risk while blocked: {revenueAtRisk}.',
      delivery: 'transactional', quietHours: 'queue', isActive: false },
    { id: 'owner.unit_blocked', name: 'Unit blocked', template: 'owner.unit_blocked', group: 'owner_approvals',
      trigger: 'unit.readiness → maintenance with nights blocked', timing: 'Immediate', channels: ['Email', 'Portal'],
      needs: 'Dates blocked, reason, revenue at risk, expected return',
      preview: '{unit} is off-sale for maintenance {dates}: {reason}. Estimated revenue impact {revenueAtRisk}. Expected back {expectedReturn}.',
      delivery: 'transactional', quietHours: 'queue', isActive: true },

    // Operations alerts
    { id: 'ops.checkin_at_risk', name: 'Check-in at risk', template: 'ops.checkin_at_risk', group: 'ops_alerts',
      trigger: 'turnover incomplete within 60 min of check-in', timing: '60 min before check-in', channels: ['In-app', 'WhatsApp group'],
      needs: 'Destination: Operations today, filtered to check-in risk',
      preview: 'Check-in risk: {unit} turnover is incomplete with a guest arriving {arrivalTime}. Assign or escalate now.',
      delivery: 'transactional', quietHours: 'override', isActive: true },
    { id: 'ops.task_unassigned', name: 'Task unassigned', template: 'ops.task_unassigned', group: 'ops_alerts',
      trigger: 'task within 3 h of due with no assignee', timing: '3 hours before due', channels: ['In-app'],
      needs: 'Destination: Operations today, Unassigned filter',
      preview: '{unit} turnover is due {dueTime} with no cleaner assigned. Assign from Operations today.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'ops.damage_reported', name: 'Damage reported', template: 'ops.damage_reported', group: 'ops_alerts',
      trigger: 'field app creates a maintenance issue', timing: 'Immediate', channels: ['In-app', 'WhatsApp'],
      needs: 'Destination: the maintenance issue',
      preview: '{crew} reported {issue} at {unit}. Opened as a maintenance issue — review and triage.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'ops.guest_message', name: 'Guest message', template: 'ops.guest_message', group: 'ops_alerts',
      trigger: 'inbound guest message', timing: 'Immediate', channels: ['In-app'],
      needs: 'Destination: Inbox thread',
      preview: 'New message from {guest} about {unit}: "{snippet}". Reply in the inbox.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'ops.channel_sync_failed', name: 'Channel sync failed', template: 'ops.channel_sync_failed', group: 'ops_alerts',
      trigger: 'integration.state → failed', timing: 'Immediate', channels: ['In-app banner', 'Email to management'],
      needs: 'Destination: System, Integrations',
      preview: '{provider} sync failed at {time}. Bookings may be delayed until it is reconnected.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'finance.statements_unsent', name: 'Statements unsent', template: 'finance.statements_unsent', group: 'ops_alerts',
      trigger: 'finalised statements unsent 3 days after close', timing: '3 days after period close', channels: ['In-app', 'Email'],
      needs: 'Destination: Owner statements, Not sent filter',
      preview: '{count} finalised statements for {period} are still unsent, {days} days after close.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'finance.payout_failed', name: 'Payout failed (internal)', template: 'finance.payout_failed', group: 'ops_alerts',
      trigger: 'payout.state → failed', timing: 'Immediate', channels: ['In-app', 'Email'],
      needs: 'Destination: Payouts',
      preview: 'Payout to {owner} ({amount}) failed: {reason}. Retry or update bank details in Payouts.',
      delivery: 'transactional', quietHours: 'always', isActive: true },

    // Field app
    { id: 'field.task_assigned', name: 'Task assigned', template: 'field.task_assigned', group: 'field',
      trigger: 'task.assignee_id set', timing: 'Immediate', channels: ['Push'],
      needs: 'Unit, due time, address. No financials',
      preview: 'New task: {unit} turnover, due {dueTime}. Address {address}. Access {accessInstruction}.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'field.task_reassigned', name: 'Task reassigned', template: 'field.task_reassigned', group: 'field',
      trigger: 'assignee changed away', timing: 'Immediate', channels: ['Push'],
      needs: 'Removes it from their list',
      preview: '{unit} on {dueDate} has been reassigned. It has been removed from your list.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'field.schedule_changed', name: 'Schedule changed', template: 'field.schedule_changed', group: 'field',
      trigger: 'task.due_at moved', timing: 'Immediate', channels: ['Push'],
      needs: 'Old and new time stated',
      preview: 'Schedule change: {unit} turnover moved from {oldTime} to {newTime}.',
      delivery: 'transactional', quietHours: 'always', isActive: false },
    { id: 'field.sync_failed', name: 'Sync failed', template: 'field.sync_failed', group: 'field',
      trigger: 'offline mutation rejected', timing: 'On failure', channels: ['In-app, persistent'],
      needs: 'Stays visible as Failed to sync until resolved',
      preview: 'A change you made offline could not be saved. It stays marked Failed to sync until it goes through.',
      delivery: 'transactional', quietHours: 'always', isActive: true },

    // Account and security
    { id: 'account.invited', name: 'User invited', template: 'account.invited', group: 'account',
      trigger: 'user created', timing: 'Immediate', channels: ['Email'],
      needs: 'Temporary password, sign-in link, must_change_password is true',
      preview: 'Welcome to The Conts Property OS. Sign in at {signInLink} with temporary password {tempPassword} and set your own.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'account.password_reset', name: 'Password reset', template: 'account.password_reset', group: 'account',
      trigger: 'forgot-password request', timing: 'Immediate', channels: ['Email'],
      needs: 'Reset link, 60-minute expiry stated',
      preview: 'Reset your Property OS password using this link: {resetLink}. It expires in 60 minutes.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'account.password_changed', name: 'Password changed', template: 'account.password_changed', group: 'account',
      trigger: 'password change succeeds', timing: 'Immediate', channels: ['Email'],
      needs: 'Time and device, plus a route if it was not them',
      preview: 'Your Property OS password was changed {time} on {device}. If this was not you, secure your account: {securityLink}.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'account.locked', name: 'Account locked', template: 'account.locked', group: 'account',
      trigger: '5 failed sign-in attempts', timing: 'Immediate', channels: ['Email'],
      needs: 'Unlock time, administrator route',
      preview: 'Your account is locked until {unlockTime} after five failed sign-ins. Ask an administrator to reset it sooner.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
    { id: 'account.new_device', name: 'New device sign-in', template: 'account.new_device', group: 'account',
      trigger: 'sign-in from an unrecognised device', timing: 'Immediate', channels: ['Email'],
      needs: 'Time, approximate location, device',
      preview: 'New sign-in to Property OS from {device} near {location} at {time}. If this was not you, {securityLink}.',
      delivery: 'transactional', quietHours: 'always', isActive: true },
  ],
};

/* ----------------------------------------------------------------- filters */

const FILTERS: { key: 'all' | Audience; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'guest', label: 'Guests' },
  { key: 'owner', label: 'Owners' },
  { key: 'staff', label: 'Operations' },
  { key: 'field', label: 'Field app' },
  { key: 'account', label: 'Account' },
];

/* --------------------------------------------------------------- component */

export default function AutomationsPage() {
  const { data, error, reload } = useApi<Payload>('/automations', FALLBACK);
  const toast = useToast();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | Audience>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const rules = useMemo(
    () => (data?.data ?? []).map(r => ({ ...r, isActive: overrides[r.id] ?? r.isActive })),
    [data, overrides],
  );

  const total = rules.length;
  const active = rules.filter(r => r.isActive).length;
  const qh = data?.quietHours;
  const open = rules.find(r => r.id === openId) ?? null;

  async function toggle(r: Rule) {
    const next = !r.isActive;
    setOverrides(o => ({ ...o, [r.id]: next }));
    toast(next
      ? { tone: 'success', title: `${r.name} is live.`, body: 'It will send on the next matching trigger.' }
      : { tone: 'warning', title: `${r.name} moved to draft.`, body: 'No further messages will be sent from this rule.' });
    try {
      await api.patch('/automations', { id: r.id, isActive: next });
    } catch {
      // Dev: no backend. Keep the optimistic state so a missing endpoint never breaks the toggle.
    }
  }

  const visibleGroups = GROUPS.filter(g => filter === 'all' || g.audience === filter);

  return (
    <>
      <PageHeader
        title="Automations"
        sub={qh ? `${active} of ${total} active · quiet hours ${qh.from}–${qh.to} MYT` : `${active} of ${total} active`}
      />

      {error && <StaleBanner message={`Showing the last rules we have. ${error}`} onRetry={reload} />}

      {qh && (
        <div className="flex items-start gap-2.5 py-[11px] px-[14px] rounded-control bg-gold-tint border border-solid border-[var(--color-gold-200)] text-gold-ink text-pretty">
          <Icon name="MoonStar" size="sm" style={{ marginTop: 1 }} />
          <span className="text-[12px]">{qh.note}</span>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => {
          const on = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cx(
                'h-8 px-[13px] py-0 rounded-full cursor-pointer [font:inherit] border border-solid',
                on ? 'border-transparent bg-black text-white' : 'border-line bg-card text-muted-ink',
              )}>
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-[18px]">
        {visibleGroups.map(g => {
          const groupRules = rules.filter(r => r.group === g.key);
          if (groupRules.length === 0) return null;
          const groupActive = groupRules.filter(r => r.isActive).length;
          return (
            <Card key={g.key}>
              <div className="flex items-center gap-3 py-[15px] px-5 [border-bottom:1px_solid_var(--color-line)]">
                <span className="w-[34px] h-[34px] flex-none grid place-items-center rounded-control bg-muted text-ink-2">
                  <Icon name={g.icon} size="sm" />
                </span>
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-[16px] font-semibold">{g.label}</span>
                  <span className="text-[12px] text-muted-ink">{g.desc}</span>
                </div>
                <span className="text-[12px] font-medium text-muted-ink whitespace-nowrap">
                  {groupActive} of {groupRules.length} live
                </span>
              </div>

              {groupRules.map(r => (
                <RuleRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} onToggle={() => toggle(r)} />
              ))}
            </Card>
          );
        })}

        {visibleGroups.every(g => rules.filter(r => r.group === g.key).length === 0) && (
          <Card>
            <div className="py-[34px] px-[22px] text-center text-[13.5px] text-muted-ink">
              No automations match this filter.
            </div>
          </Card>
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpenId(null)} width={460}>
        {open && <RulePanel r={open} onClose={() => setOpenId(null)} onToggle={() => toggle(open)} />}
      </Drawer>
    </>
  );
}

/* ------------------------------------------------------------------- parts */

function ChannelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-5 px-2 rounded-full bg-muted text-ink-2 text-[11px] font-medium whitespace-nowrap">{label}</span>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className={cx(
        'w-11 h-[26px] flex-none rounded-full border-none cursor-pointer p-[3px] flex [transition:background_120ms_ease-out]',
        on ? 'justify-end bg-[var(--color-success-solid)]' : 'justify-start bg-line-strong',
      )}>
      <span className="w-5 h-5 rounded-full bg-white" />
    </button>
  );
}

function RuleRow({ r, onOpen, onToggle }: { r: Rule; onOpen: () => void; onToggle: () => void }) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      className="flex items-start gap-4 py-[15px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer flex-wrap">
      <div className="flex flex-col gap-1.5 flex-1 min-w-[240px]">
        <div className="flex items-center gap-[9px] flex-wrap">
          <span className="text-[14px] font-semibold">{r.name}</span>
          <Badge tone={r.isActive ? 'success' : 'neutral'} label={r.isActive ? 'Live' : 'Draft'} size="sm" />
          {r.quietHours === 'override' && <Badge tone="warning" label="Overrides quiet hours" size="sm" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] text-muted-ink">{r.timing}</span>
          <span className="text-faint">&middot;</span>
          {r.channels.map(c => <ChannelChip key={c} label={c} />)}
        </div>
        <span className="font-mono text-[11px] text-muted-ink">{r.trigger}</span>
        <span className="text-[12.5px] text-ink-2 text-pretty line-clamp-2">{r.preview}</span>
      </div>
      <Switch on={r.isActive} label={`${r.isActive ? 'Move to draft' : 'Set live'}: ${r.name}`} onToggle={onToggle} />
    </div>
  );
}

function RulePanel({ r, onClose, onToggle }: { r: Rule; onClose: () => void; onToggle: () => void }) {
  const groupMeta = GROUPS.find(g => g.key === r.group)!;
  const qh = QH_LABEL[r.quietHours];
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Trigger', value: r.trigger, mono: true },
    { label: 'Timing', value: r.timing },
    { label: 'Audience', value: AUDIENCE_LABEL[groupMeta.audience] },
    { label: 'Group', value: groupMeta.label },
    { label: 'Template key', value: r.template, mono: true },
    { label: 'Data it needs', value: r.needs },
    { label: 'Quiet hours', value: qh.label },
    { label: 'Delivery', value: DELIVERY_LABEL[r.delivery] },
  ];

  return (
    <>
      <div className="py-[18px] px-5 [border-bottom:1px_solid_var(--color-line)] flex items-start gap-3 flex-none">
        <span className="w-[34px] h-[34px] flex-none grid place-items-center rounded-control bg-muted text-ink-2">
          <Icon name={groupMeta.icon} size="sm" />
        </span>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <span className="text-[17px] font-semibold text-pretty">{r.name}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={r.isActive ? 'success' : 'neutral'} label={r.isActive ? 'Live' : 'Draft'} size="sm" />
            {r.quietHours === 'override' && <Badge tone="warning" label="Overrides quiet hours" size="sm" />}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-[30px] h-[30px] flex-none grid place-items-center rounded-full bg-muted border-none text-muted-ink cursor-pointer">
          <Icon name="X" size="sm" />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1">
        <div>
          <div className="text-[12px] font-semibold text-muted-ink mb-2">Channels</div>
          <div className="flex gap-1.5 flex-wrap">
            {r.channels.map(c => <ChannelChip key={c} label={c} />)}
          </div>
        </div>

        <div className="border border-solid border-line rounded-card overflow-hidden">
          {rows.map((row, i) => (
            <div key={row.label} className={cx('flex gap-3 py-2.5 px-[14px]', i < rows.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
              <span className="text-[12.5px] text-muted-ink w-[116px] flex-none">{row.label}</span>
              <span className={cx('text-[12.5px] text-ink text-pretty', row.mono && 'font-mono')}>{row.value}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-muted-ink mb-2">Template preview</div>
          <div className="py-[13px] px-[15px] rounded-card bg-page border border-solid border-line text-[13px] leading-[1.55] text-ink text-pretty">
            {r.preview}
          </div>
          <span className="block mt-2 text-[11.5px] text-faint text-pretty">
            Braced values are filled per send from the record. Editing templates is a backend-owned step.
          </span>
        </div>
      </div>

      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex-none flex items-center justify-between gap-3">
        <div className="flex flex-col gap-px min-w-0">
          <span className="text-[13px] font-semibold">{r.isActive ? 'Live' : 'Draft'}</span>
          <span className="text-[11.5px] text-muted-ink">
            {r.isActive ? 'Sending on matching triggers.' : 'Paused. No messages are sent.'}
          </span>
        </div>
        <Switch on={r.isActive} label={`${r.isActive ? 'Move to draft' : 'Set live'}: ${r.name}`} onToggle={onToggle} />
      </div>
    </>
  );
}
