import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { color, radius, text, tone as palette, shadow } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
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
const inputStyle = {
  display: 'block', width: '100%', boxSizing: 'border-box' as const, height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle = { fontSize: text.small, fontWeight: 500, color: color.textMuted };
const errStyle = { fontSize: text.small, color: palette.critical.fg };
const LIST_COLS = 'minmax(180px,1.6fr) minmax(180px,1.4fr) 150px 140px 120px 110px';

function TierChip({ tier }: { tier: Tier }) {
  const t = TIER[tier];
  const c = palette[t.tone];
  return (
    <span style={{
      display: 'inline-flex', justifyContent: 'center', minWidth: 64,
      fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: radius.sm,
      background: c.bg, color: c.fg,
    }}>{t.label}</span>
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
    <div role="dialog" aria-modal="true" aria-label={title} style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24,
      background: 'rgba(21,21,21,0.44)', animation: 'fade-in var(--motion-standard) var(--ease-out) both',
    }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
        background: '#FFFFFF', borderRadius: radius.card, boxShadow: shadow.overlay,
      }}>
        <div style={{ padding: '20px 22px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600 }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: color.textMuted }}>{sub}</p>}
        </div>
        <div style={{ padding: '16px 22px' }}>{children}</div>
        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page,
          display: 'flex', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap',
          position: 'sticky', bottom: 0,
        }}>{footer}</div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/users', FALLBACK);
  const toast = useToast();

  const [tab, setTab] = useState<'users' | 'permissions' | 'org'>('users');

  // Optimistic overlay: invited users prepend, per-id edits merge on top.
  const [added, setAdded] = useState<Row[]>([]);
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

  // A demo temporary password so the "temporary password" behaviour is visible;
  // the real backend generates and emails its own.
  const makeTempPassword = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
    return 'TC-' + pick(letters) + Array.from({ length: 4 }, () => pick(lower)).join('') + pick(digits) + pick(digits);
  };

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Enter a full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = 'Enter a valid work email.';
    if (rows.some(r => r.email.toLowerCase() === email.trim().toLowerCase())) errs.email = 'That email already has an account.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setBusy(true); setFieldErrors({});
    const tempPassword = makeTempPassword();
    const optimistic: Row = {
      id: crypto.randomUUID(), fullName: fullName.trim(), email: email.trim(), phone: '—',
      role, managerId: role === 'owner' ? null : managerId,
      isActive: true, mustChangePassword: true, lastLoginAt: null,
    };
    setAdded(a => [optimistic, ...a]);
    setLastTempPassword({ name: optimistic.fullName, password: tempPassword });
    toast({
      tone: 'success',
      title: `Invitation sent to ${optimistic.fullName}.`,
      body: `Temporary password ${tempPassword}. They must change it on first sign-in.`,
    });
    try {
      await api.post('/users', { fullName: optimistic.fullName, email: optimistic.email, role, managerId: optimistic.managerId });
    } catch (err) {
      // Dev: no backend. Keep the optimistic row. Only a real validation
      // failure (fields) is surfaced back onto the form.
      if (err instanceof ApiFailure && err.fields) {
        setAdded(a => a.filter(x => x.id !== optimistic.id));
        setLastTempPassword(null);
        setFieldErrors(err.fields);
        setBusy(false);
        return;
      }
    }
    reload();
    resetInvite();
  }

  /* ----------------------------- edit user ---------------------------- */
  const [editing, setEditing] = useState<Row | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('operations_staff');
  const [editManager, setEditManager] = useState<string>('');
  const [editActive, setEditActive] = useState(true);

  function openEdit(u: Row) {
    setEditing(u); setEditRole(u.role); setEditManager(u.managerId ?? ''); setEditActive(u.isActive);
  }
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    const roleChanged = editRole !== editing.role;
    const patch: Partial<Row> = { role: editRole, managerId: editManager || null, isActive: editActive };
    setEdits(m => ({ ...m, [editing.id]: { ...m[editing.id], ...patch } }));
    toast({
      tone: 'success',
      title: `${editing.fullName} updated.`,
      body: roleChanged
        ? `Role changed to ${roleLabel(editRole)}. Their navigation rebuilds on next sign-in.`
        : 'Reporting line and status saved.',
    });
    try {
      await api.patch(`/users/${editing.id}`, patch);
    } catch { /* dev: no backend, keep optimistic edit */ }
    setBusy(false); setEditing(null);
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
    setEdits(m => {
      const merged = { ...m };
      for (const [id, p] of Object.entries(patch)) merged[id] = { ...merged[id], ...p };
      return merged;
    });
    const changed = Object.keys(patch).length;
    toast({
      tone: 'success',
      title: changed ? 'Reporting line updated.' : 'No changes to the reporting line.',
      body: changed ? 'This changes escalation and rosters. It does not change anyone’s permissions.' : undefined,
    });
    try {
      await api.put('/users/org-chart', { managers: staff.map(s => ({ id: s.id, managerId: orgDraft[s.id] || null })) });
    } catch { /* dev: no backend, keep optimistic edit */ }
    setBusy(false); setOrgOpen(false);
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

      <div role="tablist" aria-label="Users and roles sections" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${color.border}`, overflowX: 'auto', marginTop: 2 }}>
        {tabs.map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              style={{
                padding: '11px 6px', marginRight: 18, background: 'none', border: 'none', cursor: 'pointer',
                font: 'inherit', fontSize: 13.5, fontWeight: on ? 600 : 400,
                color: on ? color.ink : color.textMuted, whiteSpace: 'nowrap',
                boxShadow: on ? `inset 0 -2px 0 ${color.gold}` : 'none',
              }}
            >{t.label}</button>
          );
        })}
      </div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* ------------------------------ Users tab ------------------------------ */}
      {tab === 'users' && (
        <Card>
          <div style={{ padding: '13px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: text.small, color: color.textMuted }}>Role sets what a person can do. The reporting line is separate — see the organisation chart.</span>
            <Button variant="secondary" size="sm" onClick={() => { setLastTempPassword(null); setInviteOpen(true); }}>Invite user</Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 940 }}>
              <div style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 14, padding: '9px 20px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
                <div>Name</div><div>Email</div><div>Role</div><div>Reports to</div><div>Last sign-in</div><div>Status</div>
              </div>
              {loading && rows.length === 0 ? <TableSkeleton rows={7} cols={6} /> : rows.map(u => {
                const s = status(u);
                const manager = u.managerId ? nameById[u.managerId] : null;
                return (
                  <button
                    key={u.id}
                    onClick={() => openEdit(u)}
                    style={{
                      display: 'grid', gridTemplateColumns: LIST_COLS, gap: 14, alignItems: 'center', width: '100%',
                      textAlign: 'left', minHeight: 54, padding: '9px 20px', borderBottom: `1px solid ${color.borderMuted}`,
                      background: 'none', border: 'none', borderRadius: 0, cursor: 'pointer', font: 'inherit',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, background: palette[roleTone[u.role]].bg, color: palette[roleTone[u.role]].fg, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                        {initials(u.fullName)}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.fullName}</span>
                        <span style={{ fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap' }}>{u.phone}</span>
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                    <span><span style={{ display: 'inline-flex', fontSize: text.micro, fontWeight: 500, padding: '3px 9px', borderRadius: 999, background: palette[roleTone[u.role]].bg, color: palette[roleTone[u.role]].fg, whiteSpace: 'nowrap' }}>{roleLabel(u.role)}</span></span>
                    <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: manager ? color.ink : color.faint }}>{manager ?? '—'}</span>
                    <span style={{ fontSize: 12.5, color: color.textMuted }}>{u.lastLoginAt ?? 'Never'}</span>
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
          <div style={{ padding: '13px 20px', borderBottom: `1px solid ${color.border}`, fontSize: text.small, color: color.textMuted, lineHeight: 1.5 }}>
            Deny by default. An action absent from a role is forbidden, and destinations a role cannot reach are removed from its navigation rather than disabled. This is a read-only view of the permission model — permissions are set in the role, not here.
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '11px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
            {(['full', 'edit', 'view', 'own', 'none'] as Tier[]).map(t => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: text.micro, color: color.textMuted }}>
                <TierChip tier={t} />
                <span>{t === 'full' ? 'Create, edit, delete' : t === 'edit' ? 'View and edit' : t === 'view' ? 'View only' : t === 'own' ? 'Own or assigned records' : 'No access'}</span>
              </span>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 1020 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) repeat(6,minmax(104px,1fr))', gap: 10, padding: '10px 20px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, color: color.textMuted }}>
                <div>Module</div>
                {MATRIX_COLS.map(c => <div key={c.label} title={c.title} style={{ textAlign: 'center' }}>{c.label}</div>)}
              </div>
              {MATRIX_MODULES.map(m => (
                <div key={m.module} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) repeat(6,minmax(104px,1fr))', gap: 10, alignItems: 'center', padding: '9px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{m.module}</span>
                    <span style={{ fontSize: text.micro, color: color.textMuted }}>{m.note}</span>
                  </div>
                  {MATRIX_COLS.map(c => (
                    <div key={c.label} style={{ display: 'flex', justifyContent: 'center' }}>
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
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: text.small, color: color.textMuted, maxWidth: 640, lineHeight: 1.5 }}>
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
          <form id="invite-form" onSubmit={submitInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="inv-name" style={labelStyle}>Full name</label>
              <input id="inv-name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" style={inputStyle} />
              {fieldErrors.fullName && <span style={errStyle}>{fieldErrors.fullName}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="inv-email" style={labelStyle}>Work email</label>
              <input id="inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@theconts.com" style={inputStyle} />
              {fieldErrors.email && <span style={errStyle}>{fieldErrors.email}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="inv-role" style={labelStyle}>Role</label>
                <select id="inv-role" value={role} onChange={e => setRole(e.target.value as UserRole)} style={{ ...inputStyle, textTransform: 'capitalize' }}>
                  {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{roleLabel(r)}</option>)}
                </select>
              </div>
              {role !== 'owner' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="inv-mgr" style={labelStyle}>Reports to</label>
                  <select id="inv-mgr" value={managerId} onChange={e => setManagerId(e.target.value)} style={inputStyle}>
                    <option value="">No manager</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={{ fontSize: text.small, color: color.textMuted, lineHeight: 1.5 }}>
              The role sets their permissions and landing screen. The reporting line is for escalation and rosters only.
            </div>
          </form>
          {lastTempPassword && (
            <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}` }}>
              <div style={{ fontSize: text.small, color: color.textMuted }}>Temporary password for {lastTempPassword.name}</div>
              <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 3 }}>{lastTempPassword.password}</div>
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
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" form="edit-form" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </>
          }
        >
          <form id="edit-form" onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="ed-role" style={labelStyle}>Role</label>
              <select id="ed-role" value={editRole} onChange={e => setEditRole(e.target.value as UserRole)} style={{ ...inputStyle, textTransform: 'capitalize' }}>
                {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{roleLabel(r)}</option>)}
              </select>
              {editRole !== editing.role && (
                <span style={{ fontSize: text.small, color: palette.warning.fg }}>
                  Changing the role rebuilds this person’s navigation and permissions on their next sign-in.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="ed-mgr" style={labelStyle}>Reports to</label>
              <select id="ed-mgr" value={editManager} onChange={e => setEditManager(e.target.value)} style={inputStyle}>
                <option value="">No manager</option>
                {staff.filter(s => s.id !== editing.id).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
              <span style={{ fontSize: text.small, color: color.textMuted }}>Reporting line only. It does not grant or remove any access.</span>
            </div>
            <label htmlFor="ed-active" style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <input id="ed-active" type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: text.body }}>Account is active</span>
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
          <form id="org-form" onSubmit={submitOrg} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {staff.map(s => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.fullName}</span>
                  <span style={{ fontSize: text.micro, color: color.textMuted, textTransform: 'capitalize' }}>{roleLabel(s.role)}</span>
                </div>
                <select
                  aria-label={`Manager for ${s.fullName}`}
                  value={orgDraft[s.id] ?? ''}
                  onChange={e => setOrgDraft(d => ({ ...d, [s.id]: e.target.value }))}
                  style={inputStyle}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {levels.filter(l => l.people.length).map(l => (
        <div key={l.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: color.textMuted }}>{l.label}</span>
            <span style={{ flex: 1, height: 1, background: color.borderMuted }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {l.people.map(p => {
              const reports = directReports(p.id);
              const manager = p.managerId ? nameById[p.managerId] : null;
              const meta = reports > 0
                ? `${reports} direct report${reports === 1 ? '' : 's'}`
                : manager ? `Reports to ${manager}` : null;
              return (
                <div key={p.id} style={{
                  minWidth: 188, padding: '13px 15px', borderRadius: radius.card, border: `1px solid ${color.border}`,
                  background: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 8,
                  boxShadow: `inset 3px 0 0 ${palette[roleTone[p.role]].line}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 999, background: palette[roleTone[p.role]].bg, color: palette[roleTone[p.role]].fg, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                      {initials(p.fullName)}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.fullName}</span>
                      <span style={{ fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{roleLabel(p.role)}</span>
                    </div>
                  </div>
                  {meta && <span style={{ fontSize: text.micro, color: color.textMuted }}>{meta}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
