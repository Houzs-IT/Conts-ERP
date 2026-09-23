import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone, UserRole } from '../lib/types';

/* ------------------------------------------------------------------ *
 * Users and roles — three tabs (routes.json → SYSTEM → UsersPage):
 *   1. Users        — list with role + reporting line; invite + edit.
 *   2. Permissions  — deny-by-default matrix, six roles x eleven modules,
 *                     rendered read-only from the permission model.
 *   3. Organisation — the reporting line (manager_id). Explicitly NOT a
 *                     permission source; permissions come from the role.
 * There is no backend in dev, so every mutation is applied to a local
 * overlay first and the real call is attempted in a swallowed try/catch.
 * ------------------------------------------------------------------ */

// Seven roles the server accepts (functions/api/users ROLES), highest to
// lowest access so a picker reads top-down.
const ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician', 'owner'];
const roleLabel = (r: string) => r.replace(/_/g, ' ');
const roleTone: Record<UserRole, Tone> = {
  management: 'info', operations_manager: 'info', operations_staff: 'neutral',
  finance_admin: 'success', housekeeper: 'warning', technician: 'warning', owner: 'neutral',
};

interface Row {
  id: string; fullName: string; email: string; phone: string; role: UserRole;
  managerId: string | null;
  isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null;
}
interface Payload { data: Row[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'u1', fullName: 'Lee Wei Siang', email: 'management@theconts.com', phone: '+60 12-345 6702', role: 'management', managerId: null, isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u2', fullName: 'Aina Zulkifli', email: 'aina@theconts.com', phone: '+60 12-345 6701', role: 'operations_manager', managerId: 'u1', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u4', fullName: 'Priya Devi', email: 'finance@theconts.com', phone: '+60 12-345 6703', role: 'finance_admin', managerId: 'u1', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u3', fullName: 'Chan Wei Wen', email: 'weiwen@theconts.com', phone: '+60 12-345 6704', role: 'operations_staff', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-15' },
    { id: 'u5', fullName: 'Nurul Huda', email: 'nurul@theconts.com', phone: '+60 12-345 6705', role: 'housekeeper', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u6', fullName: 'Faridah Ismail', email: 'faridah@theconts.com', phone: '+60 12-345 6706', role: 'housekeeper', managerId: 'u2', isActive: true, mustChangePassword: true, lastLoginAt: null },
    { id: 'u7', fullName: 'Hafiz Omar', email: 'hafiz@theconts.com', phone: '+60 12-345 6707', role: 'technician', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-14' },
    { id: 'u8', fullName: 'Tan Boon Huat', email: 'tanbh@example.com', phone: '+60 12-345 6715', role: 'owner', managerId: null, isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-12' },
  ],
};

/** Invited but never signed in is a distinct state from active — an account on
 *  a temporary password is a security item, not a neutral one. Owners are portal
 *  users, never part of the staff account states. */
function status(u: Row): { label: string; tone: Tone } {
  if (!u.isActive) return { label: 'Inactive', tone: 'neutral' };
  if (u.role === 'owner') return { label: 'Portal only', tone: 'neutral' };
  if (u.mustChangePassword && !u.lastLoginAt) return { label: 'Invited', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('');

/* -------------------------- permission model -------------------------- *
 * Read-only mirror of permissions.json (role -> resource -> {actions, scope}).
 * Deny by default: a resource absent for a role is forbidden (rendered None).
 * The tab shows a per-module summary chip derived from these action lists, so
 * every cell can be traced back to the permission model rather than authored
 * by hand. Six columns; Field collapses housekeeper + technician.            */
type Scope = 'all' | 'own_properties' | 'assigned' | 'none';
type Grant = { actions: string[]; scope: Scope };
type ResourceKey =
  | 'dashboard' | 'portfolio' | 'reservations' | 'guests' | 'tasks' | 'maintenance'
  | 'inspections' | 'properties' | 'inventory' | 'access_credentials' | 'expenses'
  | 'statements' | 'payouts' | 'owners' | 'contracts' | 'users' | 'integrations' | 'audit';

const PERMISSIONS: Record<string, Partial<Record<ResourceKey, Grant>>> = {
  management: {
    dashboard: { actions: ['view', 'export'], scope: 'all' },
    portfolio: { actions: ['view', 'export'], scope: 'all' },
    reservations: { actions: ['view', 'create', 'edit', 'delete'], scope: 'all' },
    guests: { actions: ['view', 'edit'], scope: 'all' },
    tasks: { actions: ['view', 'create', 'edit', 'assign', 'delete'], scope: 'all' },
    maintenance: { actions: ['view', 'create', 'edit', 'approve', 'delete'], scope: 'all' },
    inspections: { actions: ['view', 'create', 'edit'], scope: 'all' },
    properties: { actions: ['view', 'create', 'edit', 'delete'], scope: 'all' },
    inventory: { actions: ['view', 'create', 'edit', 'delete'], scope: 'all' },
    access_credentials: { actions: ['view', 'create', 'edit', 'reveal'], scope: 'all' },
    expenses: { actions: ['view', 'create', 'edit', 'delete', 'export'], scope: 'all' },
    statements: { actions: ['view', 'create', 'edit', 'send', 'export'], scope: 'all' },
    payouts: { actions: ['view', 'create', 'edit', 'export'], scope: 'all' },
    owners: { actions: ['view', 'create', 'edit'], scope: 'all' },
    contracts: { actions: ['view', 'create', 'edit'], scope: 'all' },
    users: { actions: ['view', 'create', 'edit', 'delete'], scope: 'all' },
    integrations: { actions: ['view', 'edit'], scope: 'all' },
    audit: { actions: ['view', 'export'], scope: 'all' },
  },
  operations_manager: {
    dashboard: { actions: ['view', 'export'], scope: 'all' },
    portfolio: { actions: ['view'], scope: 'all' },
    reservations: { actions: ['view', 'create', 'edit'], scope: 'all' },
    guests: { actions: ['view', 'edit'], scope: 'all' },
    tasks: { actions: ['view', 'create', 'edit', 'assign'], scope: 'all' },
    maintenance: { actions: ['view', 'create', 'edit'], scope: 'all' },
    inspections: { actions: ['view', 'create', 'edit'], scope: 'all' },
    properties: { actions: ['view', 'create', 'edit'], scope: 'all' },
    inventory: { actions: ['view', 'create', 'edit'], scope: 'all' },
    access_credentials: { actions: ['view', 'edit', 'reveal'], scope: 'all' },
    expenses: { actions: ['view', 'create'], scope: 'all' },
    statements: { actions: ['view'], scope: 'all' },
    payouts: { actions: ['view'], scope: 'all' },
    owners: { actions: ['view', 'edit'], scope: 'all' },
    contracts: { actions: ['view'], scope: 'all' },
    audit: { actions: ['view'], scope: 'all' },
  },
  operations_staff: {
    dashboard: { actions: ['view'], scope: 'all' },
    reservations: { actions: ['view', 'create', 'edit'], scope: 'all' },
    guests: { actions: ['view', 'edit'], scope: 'all' },
    tasks: { actions: ['view', 'create', 'edit', 'assign'], scope: 'all' },
    maintenance: { actions: ['view', 'create', 'edit'], scope: 'all' },
    inspections: { actions: ['view', 'create', 'edit'], scope: 'all' },
    properties: { actions: ['view'], scope: 'all' },
    inventory: { actions: ['view', 'edit'], scope: 'all' },
    access_credentials: { actions: ['view'], scope: 'all' },
    expenses: { actions: [], scope: 'none' },
    statements: { actions: [], scope: 'none' },
    payouts: { actions: [], scope: 'none' },
    contracts: { actions: [], scope: 'none' },
  },
  finance_admin: {
    dashboard: { actions: ['view', 'export'], scope: 'all' },
    portfolio: { actions: ['view', 'export'], scope: 'all' },
    reservations: { actions: ['view'], scope: 'all' },
    tasks: { actions: ['view'], scope: 'all' },
    maintenance: { actions: ['view'], scope: 'all' },
    properties: { actions: ['view'], scope: 'all' },
    expenses: { actions: ['view', 'create', 'edit', 'delete', 'export'], scope: 'all' },
    statements: { actions: ['view', 'create', 'edit', 'send', 'export'], scope: 'all' },
    payouts: { actions: ['view', 'create', 'edit', 'export'], scope: 'all' },
    owners: { actions: ['view', 'edit'], scope: 'all' },
    contracts: { actions: ['view', 'create', 'edit'], scope: 'all' },
    audit: { actions: ['view', 'export'], scope: 'all' },
  },
  housekeeper: {
    tasks: { actions: ['view', 'edit'], scope: 'assigned' },
    maintenance: { actions: ['view', 'create'], scope: 'assigned' },
    properties: { actions: ['view'], scope: 'assigned' },
    access_credentials: { actions: ['view'], scope: 'assigned' },
    inventory: { actions: ['view'], scope: 'assigned' },
    guests: { actions: [], scope: 'none' },
  },
  technician: {
    tasks: { actions: ['view', 'edit'], scope: 'assigned' },
    maintenance: { actions: ['view', 'create', 'edit'], scope: 'assigned' },
    properties: { actions: ['view'], scope: 'assigned' },
    access_credentials: { actions: ['view'], scope: 'assigned' },
    inventory: { actions: ['view', 'edit'], scope: 'assigned' },
    expenses: { actions: ['create'], scope: 'assigned' },
  },
  owner: {
    statements: { actions: ['view', 'export'], scope: 'own_properties' },
    payouts: { actions: ['view'], scope: 'own_properties' },
    expenses: { actions: ['view'], scope: 'own_properties' },
    maintenance: { actions: ['view', 'approve'], scope: 'own_properties' },
    properties: { actions: ['view'], scope: 'own_properties' },
    reservations: { actions: ['view'], scope: 'own_properties' },
    contracts: { actions: ['view'], scope: 'own_properties' },
  },
};

type Tier = 'full' | 'edit' | 'view' | 'own' | 'none';
const TIER: Record<Tier, { label: string; tone: Tone }> = {
  full: { label: 'Full', tone: 'success' },
  edit: { label: 'Edit', tone: 'info' },
  view: { label: 'View', tone: 'neutral' },
  own: { label: 'Own only', tone: 'warning' },
  none: { label: 'None', tone: 'critical' },
};
const RANK: Record<Tier, number> = { none: 0, own: 1, view: 2, edit: 3, full: 4 };

function tierOfGrant(g?: Grant): Tier {
  if (!g || g.scope === 'none' || g.actions.length === 0) return 'none';
  if (g.scope !== 'all') return 'own';
  if (g.actions.includes('create') || g.actions.includes('delete')) return 'full';
  if (g.actions.includes('edit')) return 'edit';
  return 'view';
}
/** Roll a module (several resources) and a column (one or two roles) up to the
 *  most permissive tier any of them grants. */
function cellTier(resources: ResourceKey[], roles: string[]): Tier {
  let best: Tier = 'none';
  for (const role of roles) {
    for (const res of resources) {
      const t = tierOfGrant(PERMISSIONS[role]?.[res]);
      if (RANK[t] > RANK[best]) best = t;
    }
  }
  return best;
}

const MATRIX_COLS: { label: string; title: string; roles: string[] }[] = [
  { label: 'Mgmt', title: 'Management', roles: ['management'] },
  { label: 'Ops mgr', title: 'Operations manager', roles: ['operations_manager'] },
  { label: 'Ops staff', title: 'Operations staff', roles: ['operations_staff'] },
  { label: 'Finance', title: 'Finance admin', roles: ['finance_admin'] },
  { label: 'Field', title: 'Housekeeping and technicians', roles: ['housekeeper', 'technician'] },
  { label: 'Owner', title: 'Property owner (portal)', roles: ['owner'] },
];
const MATRIX_MODULES: { module: string; note: string; resources: ResourceKey[] }[] = [
  { module: 'Dashboard', note: 'KPIs and exceptions', resources: ['dashboard', 'portfolio'] },
  { module: 'Reservations', note: 'Calendar, bookings, guests', resources: ['reservations', 'guests'] },
  { module: 'Operations', note: 'Today, housekeeping, maintenance', resources: ['tasks', 'maintenance', 'inspections'] },
  { module: 'Properties', note: 'Buildings, units, access keys', resources: ['properties', 'inventory', 'access_credentials'] },
  { module: 'Monthly expenses', note: 'Utilities and deductions', resources: ['expenses'] },
  { module: 'Owner statements', note: 'Generate and send', resources: ['statements'] },
  { module: 'Payouts', note: 'Bank transfers', resources: ['payouts'] },
  { module: 'Owners and contracts', note: 'Owner records and agreements', resources: ['owners', 'contracts'] },
  { module: 'Users and roles', note: 'Invite and permissions', resources: ['users'] },
  { module: 'Integrations', note: 'Channel and bank connections', resources: ['integrations'] },
  { module: 'Audit trail', note: 'Who changed what', resources: ['audit'] },
];

/* ------------------------------- styles ------------------------------- */
// The former inputStyle object ended with `font: 'inherit'` (last shorthand key),
// so inputs/selects actually render at the inherited 16px / 400 / IBM Plex Sans —
// reproduced with [font:inherit]. py-0 zeroes the UA vertical padding (no preflight).
const inputClass = 'block w-full box-border h-10 px-3 py-0 [font:inherit] text-ink bg-card border border-solid border-line rounded-control outline-none';
const labelClass = 'text-[12px] font-medium text-muted-ink';
const errClass = cx('text-[12px]', TONE.critical.text);
const LIST_COLS_CLASS = 'grid-cols-[minmax(180px,1.6fr)_minmax(180px,1.4fr)_150px_140px_120px_110px]';
const MATRIX_COLS_CLASS = 'grid-cols-[minmax(200px,1.5fr)_repeat(6,minmax(104px,1fr))]';
// Left accent on org cards — the -line tone shade, as a box-shadow inset (kept off
// the border so it does not change the card geometry). Static per-tone literals so
// the JIT scanner sees each class.
const ORG_ACCENT: Record<Tone, string> = {
  success:  '[box-shadow:inset_3px_0_0_var(--color-success-line,#16845B)]',
  warning:  '[box-shadow:inset_3px_0_0_var(--color-warning-line,#B7791F)]',
  critical: '[box-shadow:inset_3px_0_0_var(--color-critical-line,#C2413B)]',
  info:     '[box-shadow:inset_3px_0_0_var(--color-info-line,#2E6DA4)]',
  neutral:  '[box-shadow:inset_3px_0_0_var(--color-neutral-line,#C7C1B6)]',
};

function TierChip({ tier }: { tier: Tier }) {
  const t = TIER[tier];
  return (
    <span className={cx('inline-flex justify-center min-w-[64px] text-[10.5px] font-semibold py-[3px] px-2 rounded-[6px]', TONE[t.tone].bg, TONE[t.tone].text)}>{t.label}</span>
  );
}

/** Local modal shell — the shared Dialog is confirmation-only, so form-bearing
 *  dialogs (invite, edit, org structure) get this lightweight overlay. */
function Modal({ title, sub, onClose, children, footer, width = 460 }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[rgba(21,21,21,0.44)] animate-[fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-h-[calc(100vh-48px)] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]" style={{ maxWidth: width }}>
        <div className="pt-5 px-[22px] pb-1 flex flex-col gap-[5px]">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">{title}</h2>
          {sub && <p className="m-0 text-[13px] leading-[1.5] text-muted-ink">{sub}</p>}
        </div>
        <div className="py-4 px-[22px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page flex justify-end gap-[9px] flex-wrap sticky bottom-0">{footer}</div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/users', FALLBACK);
  const toast = useToast();

  const [tab, setTab] = useState<'users' | 'permissions' | 'org'>('users');

  // Optimistic overlay: invited users prepend, per-id edits merge on top.
  const [added] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].map(r => ({ ...r, ...edits[r.id] })),
    [added, data, edits],
  );
  const nameById = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r.fullName])), [rows]);

  const staff = rows.filter(r => r.role !== 'owner');
  const invitedCount = rows.filter(r => status(r).label === 'Invited').length;

  /* ------------------------------ invite ------------------------------ */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operations_staff');
  const [managerId, setManagerId] = useState<string>('u1');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastTempPassword, setLastTempPassword] = useState<{ name: string; password: string } | null>(null);

  function resetInvite() {
    setInviteOpen(false); setFullName(''); setEmail(''); setRole('operations_staff');
    setManagerId('u1'); setFieldErrors({}); setBusy(false);
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Enter a full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = 'Enter a valid work email.';
    if (rows.some(r => r.email.toLowerCase() === email.trim().toLowerCase())) errs.email = 'That email already has an account.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setBusy(true); setFieldErrors({});
    try {
      const res = await api.post<{ id: string; delivery: string; reason?: string }>('/users', { fullName: fullName.trim(), email: email.trim(), role, managerId: role === 'owner' ? null : managerId || null });
      toast(res.delivery === 'sent'
        ? { tone: 'success', title: `Invitation sent to ${fullName.trim()}.`, body: 'A temporary password was emailed. They must change it on first sign-in.' }
        : { tone: 'warning', title: `${fullName.trim()}'s account was created, but the email was not delivered.`, body: res.reason ?? 'The email service is not connected, so the invitation is queued. Ask them to use Forgot password once email works.' });
      reload();
      resetInvite();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setFieldErrors(err.fields);
      toast({ tone: 'critical', title: 'The invitation was not sent.', body: err instanceof Error ? err.message : 'Try again in a moment.' });
      setBusy(false);
    }
  }

  /* ----------------------------- edit user ---------------------------- */
  const [editing, setEditing] = useState<Row | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('operations_staff');
  const [editManager, setEditManager] = useState<string>('');
  const [editActive, setEditActive] = useState(true);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editErrors, setEditErrors] = useState<{ fullName?: string; email?: string }>({});

  function openEdit(u: Row) {
    setEditing(u); setEditRole(u.role); setEditManager(u.managerId ?? ''); setEditActive(u.isActive);
    setEditName(u.fullName); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditErrors({});
  }
  // Re-send the invitation to someone who was invited but never signed in — a fresh
  // temporary password, emailed immediately. See functions/api/users/[id]/resend-invite.ts.
  async function resendInvite() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ delivery: string; reason?: string }>(`/users/${editing.id}/resend-invite`, {});
      if (res.delivery === 'sent') toast({ tone: 'success', title: `Invitation re-sent to ${editing.email}.`, body: 'A fresh temporary password is on its way.' });
      else if (res.delivery === 'failed') toast({ tone: 'critical', title: 'Invitation could not be sent.', body: res.reason ?? 'The email provider is not configured — see IT.' });
      else toast({ tone: 'warning', title: 'Invitation queued, not yet delivered.', body: res.reason ?? 'It will send shortly.' });
      setEditing(null);
    } catch (err) {
      toast({ tone: 'critical', title: 'Could not re-send the invitation.', body: err instanceof Error ? err.message : 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    const errs: { fullName?: string; email?: string } = {};
    if (!editName.trim()) errs.fullName = 'Enter a name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editEmail)) errs.email = 'Enter a valid email address.';
    if (Object.keys(errs).length) { setEditErrors(errs); return; }

    setBusy(true); setEditErrors({});
    const roleChanged = editRole !== editing.role;
    const patch = {
      role: editRole, managerId: editManager || null, isActive: editActive,
      fullName: editName.trim(), email: editEmail.trim(), phone: editPhone.trim() || null,
    };
    try {
      await api.patch(`/users/${editing.id}`, patch);
      setEdits(m => ({ ...m, [editing.id]: { ...m[editing.id], ...patch, phone: patch.phone ?? '' } }));
      toast({
        tone: 'success',
        title: `${editName.trim()} updated.`,
        body: roleChanged
          ? `Role changed to ${roleLabel(editRole)}. Their navigation rebuilds on next sign-in.`
          : 'Account details saved.',
      });
      reload();
      setEditing(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setEditErrors(err.fields);
      toast({ tone: 'critical', title: `${editing.fullName} was not updated.`, body: err instanceof Error ? err.message : 'Try again in a moment.' });
    }
    setBusy(false);
  }

  /* -------------------------- edit org chart -------------------------- */
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgDraft, setOrgDraft] = useState<Record<string, string>>({});
  function openOrg() {
    setOrgDraft(Object.fromEntries(staff.map(s => [s.id, s.managerId ?? ''])));
    setOrgOpen(true);
  }
  async function submitOrg(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const patch: Record<string, Partial<Row>> = {};
    for (const s of staff) {
      const next = orgDraft[s.id] ?? '';
      if ((s.managerId ?? '') !== next) patch[s.id] = { managerId: next || null };
    }
    const changed = Object.keys(patch).length;
    try {
      if (changed) await api.put('/users/org-chart', { managers: staff.map(s => ({ id: s.id, managerId: orgDraft[s.id] || null })) });
      setEdits(m => {
        const merged = { ...m };
        for (const [id, p] of Object.entries(patch)) merged[id] = { ...merged[id], ...p };
        return merged;
      });
      toast({
        tone: 'success',
        title: changed ? 'Reporting line updated.' : 'No changes to the reporting line.',
        body: changed ? 'This changes escalation and rosters. It does not change anyone’s permissions.' : undefined,
      });
      if (changed) reload();
      setOrgOpen(false);
    } catch (err) {
      toast({ tone: 'critical', title: 'Reporting line was not saved.', body: err instanceof Error ? err.message : 'Try again in a moment.' });
    }
    setBusy(false);
  }

  /* ------------------------------- tabs ------------------------------- */
  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'users', label: 'Users' },
    { key: 'permissions', label: 'Permissions' },
    { key: 'org', label: 'Organisation chart' },
  ];

  return (
    <>
      <PageHeader
        title="Users and roles"
        sub={`${rows.length} accounts · ${invitedCount} invited and not yet signed in`}
        right={tab === 'users' && (
          <Button variant="primary" size="sm" onClick={() => { setLastTempPassword(null); setInviteOpen(true); }}>
            Invite user
          </Button>
        )}
      />

      <div role="tablist" aria-label="Users and roles sections" className="flex gap-1 [border-bottom:1px_solid_var(--color-line,#DEDAD3)] overflow-x-auto mt-0.5">
        {tabs.map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cx(
                'px-[6px] py-[11px] mr-[18px] bg-transparent border-none cursor-pointer font-sans text-[13.5px] whitespace-nowrap',
                on ? 'font-semibold text-ink [box-shadow:inset_0_-2px_0_var(--color-gold,#C8A46A)]' : 'font-normal text-muted-ink',
              )}
            >{t.label}</button>
          );
        })}
      </div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* ------------------------------ Users tab ------------------------------ */}
      {tab === 'users' && (
        <Card>
          <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line,#DEDAD3)] flex items-center justify-between gap-[14px] flex-wrap">
            <span className="text-[12px] text-muted-ink">Role sets what a person can do. The reporting line is separate — see the organisation chart.</span>
            <Button variant="secondary" size="sm" onClick={() => { setLastTempPassword(null); setInviteOpen(true); }}>Invite user</Button>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[940px]">
              <div className={cx('grid', LIST_COLS_CLASS, 'gap-[14px] py-[9px] px-5 bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-[12px] font-semibold text-muted-ink')}>
                <div>Name</div><div>Email</div><div>Role</div><div>Reports to</div><div>Last sign-in</div><div>Status</div>
              </div>
              {loading && rows.length === 0 ? <TableSkeleton rows={7} cols={6} /> : rows.map(u => {
                const s = status(u);
                const manager = u.managerId ? nameById[u.managerId] : null;
                return (
                  <button
                    key={u.id}
                    onClick={() => openEdit(u)}
                    className={cx('grid', LIST_COLS_CLASS, 'gap-[14px] items-center w-full text-left min-h-[54px] py-[9px] px-5 bg-transparent border-none rounded-none cursor-pointer [font:inherit]')}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className={cx('w-[30px] h-[30px] flex-none rounded-full grid place-items-center text-[11px] font-semibold', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>
                        {initials(u.fullName)}
                      </span>
                      <span className="flex flex-col gap-px min-w-0">
                        <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{u.fullName}</span>
                        <span className="text-[11px] text-muted-ink whitespace-nowrap">{u.phone}</span>
                      </span>
                    </span>
                    <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.email}</span>
                    <span><span className={cx('inline-flex text-[11px] font-medium py-[3px] px-[9px] rounded-full whitespace-nowrap', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>{roleLabel(u.role)}</span></span>
                    <span className={cx('text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis', manager ? 'text-ink' : 'text-faint')}>{manager ?? '—'}</span>
                    <span className="text-[12.5px] text-muted-ink">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</span>
                    <span><Badge tone={s.tone} label={s.label} /></span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* --------------------------- Permissions tab --------------------------- */}
      {tab === 'permissions' && (
        <Card>
          <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-[12px] text-muted-ink leading-[1.5]">
            Deny by default. An action absent from a role is forbidden, and destinations a role cannot reach are removed from its navigation rather than disabled. This is a read-only view of the permission model — permissions are set in the role, not here.
          </div>
          <div className="flex gap-[14px] flex-wrap py-[11px] px-5 [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
            {(['full', 'edit', 'view', 'own', 'none'] as Tier[]).map(t => (
              <span key={t} className="inline-flex items-center gap-[7px] text-[11px] text-muted-ink">
                <TierChip tier={t} />
                <span>{t === 'full' ? 'Create, edit, delete' : t === 'edit' ? 'View and edit' : t === 'view' ? 'View only' : t === 'own' ? 'Own or assigned records' : 'No access'}</span>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1020px]">
              <div className={cx('grid', MATRIX_COLS_CLASS, 'gap-2.5 py-2.5 px-5 bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-[11px] font-semibold text-muted-ink')}>
                <div>Module</div>
                {MATRIX_COLS.map(c => <div key={c.label} title={c.title} className="text-center">{c.label}</div>)}
              </div>
              {MATRIX_MODULES.map(m => (
                <div key={m.module} className={cx('grid', MATRIX_COLS_CLASS, 'gap-2.5 items-center py-[9px] px-5 [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]')}>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px] font-medium">{m.module}</span>
                    <span className="text-[11px] text-muted-ink">{m.note}</span>
                  </div>
                  {MATRIX_COLS.map(c => (
                    <div key={c.label} className="flex justify-center">
                      <TierChip tier={cellTier(m.resources, c.roles)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* --------------------------- Organisation tab -------------------------- */}
      {tab === 'org' && (
        <Card>
          <div className="py-[18px] px-[22px] flex flex-col gap-5">
            <div className="flex items-center justify-between gap-[14px] flex-wrap">
              <span className="text-[12px] text-muted-ink max-w-[640px] leading-[1.5]">
                Reporting line, not a permission source. It drives escalation and rosters. Permissions come from the role on each account — see the Permissions tab.
              </span>
              <Button variant="secondary" size="sm" onClick={openOrg}>Edit structure</Button>
            </div>
            <OrgChart staff={staff} nameById={nameById} />
          </div>
        </Card>
      )}

      {/* ------------------------------ Invite modal ------------------------------ */}
      {inviteOpen && (
        <Modal
          title="Invite a new user"
          sub="They are emailed a temporary password and must set their own on first sign-in."
          onClose={resetInvite}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={resetInvite} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" form="invite-form" loading={busy}>{busy ? 'Sending…' : 'Send invitation'}</Button>
            </>
          }
        >
          <form id="invite-form" onSubmit={submitInvite} className="flex flex-col gap-[14px]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inv-name" className={labelClass}>Full name</label>
              <input id="inv-name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" className={inputClass} />
              {fieldErrors.fullName && <span className={errClass}>{fieldErrors.fullName}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inv-email" className={labelClass}>Work email</label>
              <input id="inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@theconts.com" className={inputClass} />
              {fieldErrors.email && <span className={errClass}>{fieldErrors.email}</span>}
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inv-role" className={labelClass}>Role</label>
                <select id="inv-role" value={role} onChange={e => setRole(e.target.value as UserRole)} className={cx(inputClass, 'capitalize')}>
                  {ROLES.map(r => <option key={r} value={r} className="capitalize">{roleLabel(r)}</option>)}
                </select>
              </div>
              {role !== 'owner' && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="inv-mgr" className={labelClass}>Reports to</label>
                  <select id="inv-mgr" value={managerId} onChange={e => setManagerId(e.target.value)} className={inputClass}>
                    <option value="">No manager</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="text-[12px] text-muted-ink leading-[1.5]">
              The role sets their permissions and landing screen. The reporting line is for escalation and rosters only.
            </div>
          </form>
          {lastTempPassword && (
            <div className="mt-[14px] py-[11px] px-[13px] rounded-control bg-page border border-solid border-line">
              <div className="text-[12px] text-muted-ink">Temporary password for {lastTempPassword.name}</div>
              <div className="text-[15px] font-semibold font-mono mt-[3px]">{lastTempPassword.password}</div>
            </div>
          )}
        </Modal>
      )}

      {/* ------------------------------- Edit modal ------------------------------- */}
      {editing && (
        <Modal
          title={`Edit ${editing.fullName}`}
          sub="Change the role, reporting line or status."
          onClose={() => setEditing(null)}
          footer={
            <>
              {status(editing).label === 'Invited' && (
                <Button variant="secondary" size="sm" onClick={resendInvite} disabled={busy}>Resend invitation</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" form="edit-form" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </>
          }
        >
          <form id="edit-form" onSubmit={submitEdit} className="flex flex-col gap-[14px]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ed-name" className={labelClass}>Full name</label>
              <input id="ed-name" value={editName} onChange={e => setEditName(e.target.value)} className={inputClass} />
              {editErrors.fullName && <span className={cx('text-[12px]', TONE.critical.text)}>{editErrors.fullName}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ed-email" className={labelClass}>Email</label>
              <input id="ed-email" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className={inputClass} />
              {editErrors.email && <span className={cx('text-[12px]', TONE.critical.text)}>{editErrors.email}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ed-phone" className={labelClass}>Phone</label>
              <input id="ed-phone" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+60 12-345 6789" className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ed-role" className={labelClass}>Role</label>
              <select id="ed-role" value={editRole} onChange={e => setEditRole(e.target.value as UserRole)} className={cx(inputClass, 'capitalize')}>
                {ROLES.map(r => <option key={r} value={r} className="capitalize">{roleLabel(r)}</option>)}
              </select>
              {editRole !== editing.role && (
                <span className={cx('text-[12px]', TONE.warning.text)}>
                  Changing the role rebuilds this person’s navigation and permissions on their next sign-in.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ed-mgr" className={labelClass}>Reports to</label>
              <select id="ed-mgr" value={editManager} onChange={e => setEditManager(e.target.value)} className={inputClass}>
                <option value="">No manager</option>
                {staff.filter(s => s.id !== editing.id).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
              <span className="text-[12px] text-muted-ink">Reporting line only. It does not grant or remove any access.</span>
            </div>
            <label htmlFor="ed-active" className="flex items-center gap-[9px] cursor-pointer">
              <input id="ed-active" type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-[14px]">Account is active</span>
            </label>
          </form>
        </Modal>
      )}

      {/* ---------------------------- Edit org modal ---------------------------- */}
      {orgOpen && (
        <Modal
          title="Edit organisation structure"
          sub="Set who each person reports to. This is the reporting line for escalation and rosters — it is not a permission source."
          width={520}
          onClose={() => setOrgOpen(false)}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setOrgOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" form="org-form" loading={busy}>{busy ? 'Saving…' : 'Save structure'}</Button>
            </>
          }
        >
          <form id="org-form" onSubmit={submitOrg} className="flex flex-col gap-3">
            {staff.map(s => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 items-center">
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{s.fullName}</span>
                  <span className="text-[11px] text-muted-ink capitalize">{roleLabel(s.role)}</span>
                </div>
                <select
                  aria-label={`Manager for ${s.fullName}`}
                  value={orgDraft[s.id] ?? ''}
                  onChange={e => setOrgDraft(d => ({ ...d, [s.id]: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">No manager</option>
                  {staff.filter(o => o.id !== s.id).map(o => <option key={o.id} value={o.id}>{o.fullName}</option>)}
                </select>
              </div>
            ))}
          </form>
        </Modal>
      )}
    </>
  );
}

/* --------------------------- org chart render --------------------------- */
function OrgChart({ staff, nameById }: { staff: Row[]; nameById: Record<string, string> }) {
  // Depth by walking the manager chain (capped against accidental cycles).
  const depthOf = (u: Row): number => {
    let d = 0; let cur: Row | undefined = u; const seen = new Set<string>();
    while (cur && cur.managerId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const next = staff.find(s => s.id === cur!.managerId);
      if (!next) break;
      cur = next; d++;
      if (d > 6) break;
    }
    return d;
  };
  const directReports = (id: string) => staff.filter(s => s.managerId === id).length;

  const levels: { label: string; people: Row[] }[] = [
    { label: 'Leadership', people: [] },
    { label: 'Managers', people: [] },
    { label: 'Team', people: [] },
  ];
  for (const u of staff) {
    const d = Math.min(depthOf(u), 2);
    levels[d].people.push(u);
  }

  return (
    <div className="flex flex-col gap-5">
      {levels.filter(l => l.people.length).map(l => (
        <div key={l.label} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-ink">{l.label}</span>
            <span className="flex-1 h-px bg-[var(--color-line-soft,#EDEAE4)]" />
          </div>
          <div className="flex gap-3 flex-wrap">
            {l.people.map(p => {
              const reports = directReports(p.id);
              const manager = p.managerId ? nameById[p.managerId] : null;
              const meta = reports > 0
                ? `${reports} direct report${reports === 1 ? '' : 's'}`
                : manager ? `Reports to ${manager}` : null;
              return (
                <div key={p.id} className={cx('min-w-[188px] py-[13px] px-[15px] rounded-card border border-solid border-line bg-card flex flex-col gap-2', ORG_ACCENT[roleTone[p.role]])}>
                  <div className="flex items-center gap-2.5">
                    <span className={cx('w-8 h-8 flex-none rounded-full grid place-items-center text-[11px] font-semibold', TONE[roleTone[p.role]].bg, TONE[roleTone[p.role]].text)}>
                      {initials(p.fullName)}
                    </span>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-[13px] font-semibold whitespace-nowrap">{p.fullName}</span>
                      <span className="text-[11px] text-muted-ink whitespace-nowrap capitalize">{roleLabel(p.role)}</span>
                    </div>
                  </div>
                  {meta && <span className="text-[11px] text-muted-ink">{meta}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
