import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { SystemStats } from '../components/SystemStats';
import PermissionsChart from '../components/PermissionsChart';
import UsersSignIns from './UsersSignIns';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { PhoneInput, phoneProblem } from '../components/inputs';
import { Select, SearchSelect } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { count, date, plural } from '../lib/format';
import { ROLE_LABEL } from '../lib/vocabulary';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone, UserRole } from '../lib/types';
import { HistoryDisclosure } from '../components/RecordHistory';
import { RowActions, type RowAction } from '../components/RowActions';
import { deliveryToast } from '../lib/emailDelivery';
import Icon from '../components/Icon';

/* ------------------------------------------------------------------ *
 * Users and roles — three tabs (routes.json → SYSTEM → UsersPage):
 *   1. Users        — list with role + reporting line; invite + edit.
 *   2. Permissions  — the editable chart (components/PermissionsChart): what each
 *                     office role can do in each area, saved to role_access.
 *   3. Organisation — the reporting line (manager_id). Explicitly NOT a
 *                     permission source; permissions come from the role.
 *   4. Sign-ins     — management only: every sign-in attempt (UsersSignIns).
 * There is no backend in dev, so every mutation is applied to a local
 * overlay first and the real call is attempted in a swallowed try/catch.
 * ------------------------------------------------------------------ */

// Seven roles the server accepts (functions/api/users ROLES), highest to
// lowest access so a picker reads top-down.
const ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician', 'owner'];
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
const ROLE_OPTIONS = ROLES.map(r => ({ value: r, label: roleLabel(r) }));
// Owner logins are made from the owner's record (the server refuses them here), and a staff account never becomes one.
const STAFF_ROLE_OPTIONS = ROLE_OPTIONS.filter(o => o.value !== 'owner');
const roleTone: Record<UserRole, Tone> = {
  management: 'info', operations_manager: 'info', operations_staff: 'neutral',
  finance_admin: 'success', housekeeper: 'warning', technician: 'warning', owner: 'neutral',
};

interface Row {
  id: string; fullName: string; email: string; phone: string | null; role: UserRole;
  department?: string | null; position?: string | null;
  managerId: string | null;
  isActive: boolean; mustChangePassword: boolean; isLocked?: boolean; twoStep?: boolean; lastLoginAt: string | null;
  /** When the newest invitation email went out (audit_log user.invite / user.resend_invite). */
  lastInvitedAt?: string | null;
}
interface Payload { data: Row[]; generatedAt: string; jobFields?: boolean }

// Department and position are free text (migration 0113): the renovation pickers show them after the name, so
// picking "Alex · Project PIC · Renovation" says what the person does. These are suggestions, not a fixed list;
// values already used on other accounts are suggested too, so spellings stay consistent. Once a department is
// picked, only the positions that belong to it are suggested (plus ones other accounts in it already use).
const POSITIONS_BY_DEPARTMENT: Record<string, string[]> = {
  Management: ['Director'],
  Sales: ['Sales Executive'],
  Design: ['Interior Designer', '3D Designer', '2D Drafter'],
  Renovation: ['Project PIC', 'Site Supervisor'],
  Operations: [],
  Finance: [],
  Admin: ['Admin'],
};
const DEPARTMENT_SUGGESTIONS = Object.keys(POSITIONS_BY_DEPARTMENT);
const POSITION_SUGGESTIONS = Object.values(POSITIONS_BY_DEPARTMENT).flat();
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const suggestionsFrom = (base: string[], used: Array<string | null | undefined>) =>
  [...new Set([...base, ...used.map(v => (v ?? '').trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
/** "Position · Department", skipping what is not set. */
const jobLine = (u: Pick<Row, 'department' | 'position'>) => [u.position, u.department].map(v => (v ?? '').trim()).filter(Boolean).join(' · ');

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
  if (u.isLocked) return { label: 'Locked', tone: 'critical' };
  if (u.role === 'owner') return { label: 'Portal only', tone: 'neutral' };
  if (u.mustChangePassword && !u.lastLoginAt) return { label: 'Invited', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

const isInvited = (u: Row) => status(u).label === 'Invited';
/** "7 active, 7 invited, 2 switched off": the same states as the table's Status column, so the numbers add up. */
function accountsBreakdown(rows: Row[]) {
  const by = (label: string) => rows.filter(r => status(r).label === label).length;
  return ([['Active', 'active'], ['Invited', 'invited'], ['Locked', 'locked'], ['Inactive', 'switched off'], ['Portal only', 'owner logins']] as const)
    .map(([label, word]) => [by(label), word] as const).filter(([n]) => n > 0).map(([n, word]) => `${count(n)} ${word}`).join(', ');
}
const NO_MAIL_INVITE = 'To get them in now, use Reset password in their row menu and pass the temporary password on yourself.';

/** When the newest invitation went out, and a Resend button for management. */
function InviteCell({ u, onResend }: { u: Row; onResend?: () => void }) {
  return (
    <span className="flex items-center gap-2 min-w-0 flex-wrap" onClick={e => e.stopPropagation()}>
      <span className="text-meta text-muted-ink whitespace-nowrap">{u.lastInvitedAt ? `Invited ${date(u.lastInvitedAt)}` : 'Invited, date unknown'}</span>
      {onResend && <Button size="sm" variant="secondary" icon={<Icon name="Send" size="sm" />} onClick={onResend} aria-label={`Resend invitation to ${u.fullName}`}>Resend</Button>}
    </span>
  );
}

/** "Reports to" choices: active staff only, with the email after any name that appears twice so
 *  two people both called "New Staff" can be told apart. `keep` stays listed even if switched off, so an
 *  existing manager still shows as selected instead of the form silently reading "No manager". */
function managerOptions(staff: Row[], exclude?: string, keep?: string | null) {
  const list = staff.filter(s => s.id !== exclude && (s.isActive || s.id === keep));
  const seen = new Map<string, number>();
  for (const s of list) seen.set(s.fullName, (seen.get(s.fullName) ?? 0) + 1);
  return list.map(s => ({
    value: s.id,
    label: `${s.fullName}${(seen.get(s.fullName) ?? 0) > 1 ? ` (${s.email})` : ''}${s.isActive ? '' : ' (switched off)'}`,
  }));
}

const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('');

/* ------------------------------- styles ------------------------------- */
// Left accent on org cards — the -line tone shade, as a box-shadow inset (kept off
// the border so it does not change the card geometry). Static per-tone literals so
// the JIT scanner sees each class.
const ORG_ACCENT: Record<Tone, string> = {
  success:  '[box-shadow:inset_3px_0_0_var(--color-success-line)]',
  warning:  '[box-shadow:inset_3px_0_0_var(--color-warning-line)]',
  critical: '[box-shadow:inset_3px_0_0_var(--color-critical-line)]',
  info:     '[box-shadow:inset_3px_0_0_var(--color-info-line)]',
  neutral:  '[box-shadow:inset_3px_0_0_var(--color-neutral-line)]',
};

/** Local modal shell — the shared Dialog is confirmation-only, so form-bearing
 *  dialogs (invite, edit, org structure) get this lightweight overlay. */
function Modal({ title, sub, onClose, children, footer, width = 460 }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number;
}) {
  useEffect(() => {
    // An open dropdown inside (Department, Position) takes the first Escape; the dialog closes on the next.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] animate-[fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-h-[calc(100vh-48px)] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]" style={{ maxWidth: width }}>
        <div className="pt-5 px-[22px] pb-1 flex flex-col gap-1">
          <h2 className="m-0 text-title leading-[1.3] font-semibold">{title}</h2>
          {sub && <p className="m-0 text-copy leading-[1.5] text-muted-ink">{sub}</p>}
        </div>
        <div className="py-4 px-[22px]">{children}</div>
        <div className="py-3.5 px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-2 flex-wrap sticky bottom-0">{footer}</div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/users', FALLBACK);
  const toast = useToast();

  const [tab, setTab] = useState<'users' | 'permissions' | 'org' | 'signins'>('users');

  // Optimistic overlay: invited users prepend, per-id edits merge on top.
  const [added] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].map(r => ({ ...r, ...edits[r.id] })),
    [added, data, edits],
  );
  const nameById = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r.fullName])), [rows]);

  const staff = rows.filter(r => r.role !== 'owner');
  const jobFields = data?.jobFields === true;
  const departmentOptions = useMemo(() => suggestionsFrom(DEPARTMENT_SUGGESTIONS, rows.map(r => r.department)), [rows]);
  const positionsFor = useMemo(() => {
    const all = suggestionsFrom(POSITION_SUGGESTIONS, rows.map(r => r.position));
    // Unknown or empty department, or one with nothing to suggest yet: offer every position.
    return (dept: string) => {
      if (!dept.trim()) return all;
      const base = Object.entries(POSITIONS_BY_DEPARTMENT).find(([k]) => sameText(k, dept))?.[1] ?? [];
      const own = suggestionsFrom(base, rows.filter(r => sameText(r.department, dept)).map(r => r.position));
      return own.length ? own : all;
    };
  }, [rows]);
  // Which department a position belongs to: the built-in list first, then what other accounts use.
  const departmentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.position?.trim() && r.department?.trim()) m.set(r.position.trim().toLowerCase(), r.department.trim());
    for (const [d, ps] of Object.entries(POSITIONS_BY_DEPARTMENT)) for (const p of ps) m.set(p.toLowerCase(), d);
    return (pos: string) => m.get(pos.trim().toLowerCase()) ?? null;
  }, [rows]);

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'name', label: 'Name', value: u => u.fullName, hideable: false, width: 220,
      render: u => (
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={cx('w-[30px] h-[30px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>
            {initials(u.fullName)}
          </span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={u.fullName}>{u.fullName}</span>
            <span className="text-caption text-muted-ink whitespace-nowrap">{u.phone || '—'}</span>
          </span>
        </span>
      ) },
    ...(jobFields ? [
      { key: 'position', label: 'Position', value: (u: Row) => u.position || null, width: 160 },
      { key: 'department', label: 'Department', value: (u: Row) => u.department || null, width: 140 },
    ] : []),
    { key: 'email', label: 'Email', value: u => u.email, width: 210 },
    { key: 'phone', label: 'Phone', type: 'phone', value: u => u.phone || null, hidden: true, width: 140 },
    { key: 'role', label: 'Role', type: 'status', value: u => u.role, status: u => ({ label: roleLabel(u.role), tone: roleTone[u.role] }), width: 150 },
    { key: 'manager', label: 'Reports to', type: 'person', value: u => (u.managerId ? nameById[u.managerId] ?? null : null), width: 150 },
    // An invited person has no sign-in yet, so this cell says when the newest invitation went out, with Resend beside it.
    { key: 'lastLogin', label: 'Last sign-in', type: 'date', value: u => u.lastLoginAt, width: 230,
      render: u => isInvited(u) ? <InviteCell u={u} onResend={canManageRef.current ? () => resendRef.current(u) : undefined} />
        : <span className="text-copy text-muted-ink whitespace-nowrap">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</span> },
    { key: 'status', label: 'Status', type: 'status', value: u => status(u).label, status: u => status(u), width: 110 },
    { key: 'invited', label: 'Invitation sent', type: 'date', value: u => (isInvited(u) ? u.lastInvitedAt ?? null : null), hidden: true, width: 140 },
    // The menu is read through a ref: its actions depend on state the memoised columns would otherwise hold stale.
    { key: 'actions', label: '', width: 52, align: 'right', noExport: true, sortable: false, filter: false, hideable: false,
      render: u => <RowActions name={u.fullName} items={actionsRef.current(u)} /> },
  ], [nameById, jobFields]);
  const invitedRows = rows.filter(isInvited);
  const invitedCount = invitedRows.length;
  const actionsRef = useRef<(u: Row) => RowAction[]>(() => []);
  const resendRef = useRef<(u: Row) => void>(() => {});
  const canManageRef = useRef(false);

  /* ------------------------------ invite ------------------------------ */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operations_staff');
  const [managerId, setManagerId] = useState<string>('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastTempPassword, setLastTempPassword] = useState<{ name: string; password: string } | null>(null);

  function resetInvite() {
    setInviteOpen(false); setFullName(''); setEmail(''); setRole('operations_staff');
    setManagerId(''); setDepartment(''); setPosition(''); setFieldErrors({}); setBusy(false);
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
      const res = await api.post<{ id: string; delivery: string; reason?: string }>('/users', { fullName: fullName.trim(), email: email.trim(), role, managerId: role === 'owner' ? null : managerId || null,
        ...(jobFields ? { department: department.trim() || null, position: position.trim() || null } : {}) });
      toast(res.delivery === 'sent'
        ? { tone: 'success', title: `Invitation sent to ${fullName.trim()}.`, body: 'A temporary password was emailed. They must change it on first sign-in.' }
        : { tone: 'warning', title: `${fullName.trim()}'s account was created, but the email was not delivered.`, body: res.reason ?? 'The email service is not connected, so the invitation is queued. Ask them to use Forgot password once email works.' });
      reload();
      resetInvite();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setFieldErrors(err.fields);
      toast({ tone: 'critical', title: 'The invitation was not sent.', body: errorMessage(err, 'Try again in a moment.') });
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
  const [editDepartment, setEditDepartment] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editErrors, setEditErrors] = useState<{ fullName?: string; email?: string; phone?: string; department?: string; position?: string }>({});

  function openEdit(u: Row) {
    setEditing(u); setEditRole(u.role); setEditManager(u.managerId ?? ''); setEditActive(u.isActive);
    setEditName(u.fullName); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditDepartment(u.department ?? ''); setEditPosition(u.position ?? ''); setEditErrors({});
  }
  // Re-send the invitation to someone who was invited but never signed in — a fresh
  // temporary password, emailed immediately. See functions/api/users/[id]/resend-invite.ts.
  async function resendInvite(u: Row) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ delivery: string; reason?: string }>(`/users/${u.id}/resend-invite`, {});
      toast(deliveryToast(res, { title: `Invitation re-sent to ${u.email}.`, body: 'A fresh temporary password is on its way.' }, 'invitation', NO_MAIL_INVITE));
      setEditing(null); setConfirm(null);
      reload();
    } catch (err) {
      toast({ tone: 'critical', title: 'Could not re-send the invitation.', body: errorMessage(err, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  // A one-time reset link shown here once, for management to pass on by WhatsApp or in person when the
  // reset email cannot reach the person. See functions/api/users/[id]/reset-link.ts.
  const [resetLink, setResetLink] = useState<{ link: string; expiresAt: string; email: string } | null>(null);
  async function makeResetLink(u: Row) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ link: string; expiresAt: string; email: string }>(`/users/${u.id}/reset-link`, {});
      setResetLink(res);
    } catch (err) {
      toast({ tone: 'critical', title: 'Could not make a reset link.', body: errorMessage(err, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  /* ---------------------------- row actions --------------------------- */
  // Passwords stay hashed. The one exception is Reset password: the server returns a temporary password
  // once, it is shown here once to be passed on, and it is dropped from memory when this box closes.
  // See functions/api/users/[id]/security.ts.
  const { user: me } = useSession();
  const canManage = me?.role === 'management';
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [tempShown, setTempShown] = useState<{ name: string; email: string; password: string } | null>(null);

  function confirmResend(u: Row) {
    setConfirm({
      title: `Resend the invitation to ${u.fullName}?`,
      body: 'They get a fresh temporary password by email. The one in the earlier email stops working.',
      meta: `Sent to ${u.email}${u.lastInvitedAt ? ` · last sent ${date(u.lastInvitedAt)}` : ''}`, confirmLabel: 'Resend invitation', busyLabel: 'Sending…',
      onConfirm: () => resendInvite(u),
    });
  }
  resendRef.current = confirmResend;
  canManageRef.current = canManage;
  // One request per person, one after another, so each gets their own password and audit row; a refusal for one
  // (they signed in meanwhile) does not stop the rest.
  async function resendAll() {
    const list = invitedRows;
    let sent = 0, noMail = 0, other = 0;
    const refused: string[] = [];
    setBusy(true);
    for (const u of list) {
      try {
        const res = await api.post<{ delivery: string; reason?: string }>(`/users/${u.id}/resend-invite`, {});
        if (res.delivery === 'sent') sent++;
        else if (res.delivery === 'failed' && /not configured/i.test(res.reason ?? '')) noMail++;
        else other++;
      } catch { refused.push(u.fullName); }
    }
    setBusy(false);
    setConfirm(null);
    reload();
    const tail = refused.length ? ` Not re-sent: ${refused.join(', ')}.` : '';
    if (noMail) toast({ tone: 'critical', title: 'Invitations were not emailed: email is not set up on this system.',
      body: `New temporary passwords were made for ${plural(list.length - refused.length, 'person', 'people')}, but no mail provider key is set here, so nothing went out. ${NO_MAIL_INVITE}${tail}` });
    else if (other || refused.length) toast({ tone: 'warning', title: `${sent} of ${list.length} invitations sent.`,
      body: `${other ? `${other} queued or failed and will be retried.` : ''}${tail}`.trim() });
    else toast({ tone: 'success', title: `${plural(sent, 'invitation')} re-sent.`, body: 'Each person has a fresh temporary password by email.' });
  }

  async function act(u: Row, call: () => Promise<unknown>, done: string, body?: string) {
    setBusy(true);
    try {
      const res = (await call()) as { delivery?: string; reason?: string } | undefined;
      if (res?.delivery && res.delivery !== 'sent') {
        toast(res.delivery === 'failed'
          ? { tone: 'critical', title: 'The email could not be sent.', body: res.reason ?? 'The email provider is not configured.' }
          : { tone: 'warning', title: 'Email queued, not yet delivered.', body: res.reason ?? 'It will send shortly.' });
      } else toast({ tone: 'success', title: done, body });
      reload();
      setConfirm(null);
    } catch (err) {
      toast({ tone: 'critical', title: `Nothing changed for ${u.fullName}.`, body: errorMessage(err, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  async function copyResetLink() {
    if (!resetLink) return;
    try { await navigator.clipboard.writeText(resetLink.link); toast({ tone: 'success', title: 'Reset link copied.', body: 'Send it to the person directly. It works once and expires in 60 minutes.' }); }
    catch { toast({ tone: 'warning', title: 'Copy did not work.', body: 'Select the link and copy it by hand.' }); }
  }
  const security = (u: Row, action: string) => () => api.post(`/users/${u.id}/security`, { action });
  const setActive = (u: Row, isActive: boolean) => async () => {
    await api.patch(`/users/${u.id}`, { isActive });
    setEdits(m => ({ ...m, [u.id]: { ...m[u.id], isActive } }));
  };

  actionsRef.current = u => actionsFor(u);
  function actionsFor(u: Row): RowAction[] {
    const self = u.id === me?.id;
    const invited = status(u).label === 'Invited';
    // Only management may change an account (functions/api/users/[id].ts); others read the list.
    if (!canManage) return [];
    const items: RowAction[] = [{ key: 'edit', label: 'Edit details', icon: 'Pencil', run: () => openEdit(u) }];
    if (u.isActive && invited) items.push({ key: 'invite', label: 'Resend invitation', icon: 'Send', run: () => confirmResend(u) });
    if (u.isActive && !invited) items.push({ key: 'reset', label: 'Email a password reset link', icon: 'Mail', run: () => setConfirm({
      title: `Send ${u.fullName} a password reset link?`,
      body: 'They get an email with a link to choose a new password. It works once and expires in 60 minutes. Their current password keeps working until they use it.',
      meta: `Sent to ${u.email}`, confirmLabel: 'Send link', busyLabel: 'Sending…',
      onConfirm: () => act(u, security(u, 'reset_email'), `Reset link sent to ${u.email}.`),
    }) });
    if (u.isActive && !invited) items.push({ key: 'link', label: 'Get a reset link to pass on', icon: 'Link', run: () => makeResetLink(u) });
    if (u.isActive && !self) items.push({ key: 'temp', label: 'Reset password', icon: 'KeyRound', run: () => setConfirm({
      title: `Reset ${u.fullName}'s password?`,
      body: 'Their current password stops working and they are signed out on every device now. You get a temporary password to give them; when they sign in with it, they must choose their own before they can do anything else.',
      confirmLabel: 'Reset and sign out', busyLabel: 'Resetting…', danger: true,
      onConfirm: () => act(u, async () => {
        const res = await api.post<{ tempPassword: string }>(`/users/${u.id}/security`, { action: 'temp_password' });
        setTempShown({ name: u.fullName, email: u.email, password: res.tempPassword });
      }, `${u.fullName}'s password was reset.`, 'They have been signed out on every device.'),
    }) });
    if (!self) items.push({ key: 'revoke', label: 'Sign out everywhere', icon: 'LogOut', run: () => setConfirm({
      title: `Sign ${u.fullName} out everywhere?`,
      body: 'Ends their sessions on every phone and computer straight away. Their password does not change, so they can sign in again. Use this for a lost phone or a shared computer.',
      confirmLabel: 'Sign out everywhere', busyLabel: 'Signing out…', danger: true,
      onConfirm: () => act(u, security(u, 'revoke_sessions'), `${u.fullName} has been signed out on every device.`),
    }) });
    if (u.twoStep && !self) items.push({ key: '2fa', label: 'Reset two-step sign-in', icon: 'ShieldOff', run: () => setConfirm({
      title: `Reset ${u.fullName}'s two-step sign-in?`,
      body: 'Use this when they lost their phone. Their authenticator code and backup codes stop working, and they sign in with their password alone. If their role requires two-step sign-in, they are asked to set it up again straight after signing in.',
      confirmLabel: 'Reset two-step sign-in', busyLabel: 'Resetting…', danger: true,
      onConfirm: () => act(u, security(u, 'reset_2fa'), `${u.fullName}'s two-step sign-in was reset.`),
    }) });
    if (u.isActive && u.isLocked) items.push({ key: 'unlock', label: 'Unlock account', icon: 'LockOpen', run: () => setConfirm({
      title: `Unlock ${u.fullName}'s account?`,
      body: 'Too many wrong passwords locked this account for a while. Unlocking lets them try again now instead of waiting.',
      confirmLabel: 'Unlock', busyLabel: 'Unlocking…',
      onConfirm: () => act(u, security(u, 'unlock'), `${u.fullName}'s account is unlocked.`),
    }) });
    if (u.isActive && !self) items.push({ key: 'off', label: 'Switch off account', icon: 'UserX', danger: true, run: () => setConfirm({
      title: `Switch off ${u.fullName}'s account?`,
      body: 'They are signed out at once and cannot sign in. Nothing is deleted: their password, history and records stay, and you can switch the account back on at any time.',
      confirmLabel: 'Switch off', busyLabel: 'Switching off…', danger: true,
      onConfirm: () => act(u, setActive(u, false), `${u.fullName}'s account is switched off.`),
    }) });
    if (!u.isActive) items.push({ key: 'on', label: 'Switch account back on', icon: 'UserCheck', run: () => setConfirm({
      title: `Switch ${u.fullName}'s account back on?`,
      body: 'They can sign in again with their existing password.',
      confirmLabel: 'Switch on', busyLabel: 'Saving…',
      onConfirm: () => act(u, setActive(u, true), `${u.fullName}'s account is switched back on.`),
    }) });
    return items;
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    const errs: { fullName?: string; email?: string; phone?: string } = {};
    if (!editName.trim()) errs.fullName = 'Enter a name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editEmail)) errs.email = 'Enter a valid email address.';
    const phoneErr = phoneProblem(editPhone);
    if (phoneErr) errs.phone = phoneErr;
    if (Object.keys(errs).length) { setEditErrors(errs); return; }

    setBusy(true); setEditErrors({});
    const roleChanged = editRole !== editing.role;
    const patch = {
      ...(roleChanged ? { role: editRole } : {}), managerId: editManager || null, isActive: editActive,
      fullName: editName.trim(), email: editEmail.trim().toLowerCase(), phone: editPhone.trim() || null,
      ...(jobFields ? { department: editDepartment.trim() || null, position: editPosition.trim() || null } : {}),
    };
    try {
      await api.patch(`/users/${editing.id}`, patch);
      setEdits(m => ({ ...m, [editing.id]: { ...m[editing.id], ...patch, phone: patch.phone ?? '' } }));
      toast({
        tone: 'success',
        title: `${editName.trim()} updated.`,
        body: roleChanged
          ? `Role changed to ${roleLabel(editRole)}. It applies straight away, on their next click.`
          : 'Account details saved.',
      });
      reload();
      setEditing(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setEditErrors(err.fields);
      toast({ tone: 'critical', title: `${editing.fullName} was not updated.`, body: errorMessage(err, 'Try again in a moment.') });
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
      toast({ tone: 'critical', title: 'Reporting line was not saved.', body: errorMessage(err, 'Try again in a moment.') });
    }
    setBusy(false);
  }

  /* ------------------------------- tabs ------------------------------- */
  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'users', label: 'Users' },
    { key: 'permissions', label: 'Permissions' },
    { key: 'org', label: 'Organisation chart' },
    ...(canManage ? [{ key: 'signins' as const, label: 'Sign-ins' }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Users and roles"
        sub={data ? `${plural(rows.length, 'account')} · ${count(invitedCount)} invited and not yet signed in` : 'Loading accounts…'}
        primary={tab === 'users' && canManage && (
          <span className="flex gap-2 flex-wrap">
            {invitedCount > 0 && (
              <Button variant="secondary" size="sm" icon={<Icon name="Send" size="sm" />} onClick={() => setConfirm({
                title: `Resend the invitation to all ${plural(invitedCount, 'invited person', 'invited people')}?`,
                body: 'Everyone who was invited and has not signed in yet gets a fresh temporary password by email. The passwords in their earlier emails stop working.',
                meta: invitedRows.map(u => u.fullName).join(', '), confirmLabel: `Resend ${plural(invitedCount, 'invitation')}`, busyLabel: 'Sending…',
                onConfirm: resendAll,
              })}>Resend to all invited ({count(invitedCount)})</Button>
            )}
            <Button variant="primary" size="sm" onClick={() => { setLastTempPassword(null); setInviteOpen(true); }}>
              Invite user
            </Button>
          </span>
        )}
      />

      <SystemStats loading={loading && rows.length === 0} stats={[
        { label: 'Accounts', value: data ? count(rows.length) : undefined, hint: accountsBreakdown(rows) },
        { label: 'Invited', value: data ? count(invitedCount) : undefined, hint: 'Not signed in yet', warn: invitedCount > 0 },
        { label: 'Two-step on', value: data ? count(rows.filter(r => r.twoStep).length) : undefined, hint: 'Sign-in with a code' },
        { label: 'Locked', value: data ? count(rows.filter(r => r.isLocked).length) : undefined, hint: 'Too many wrong passwords', warn: rows.some(r => r.isLocked) },
      ]} />

      <div role="tablist" aria-label="Users and roles sections" className="flex shrink-0 gap-1 [border-bottom:1px_solid_var(--color-line)] overflow-x-auto mt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cx(
                'px-1.5 py-3 mr-4 bg-transparent border-none cursor-pointer font-sans text-copy whitespace-nowrap',
                on ? 'font-semibold text-ink [box-shadow:inset_0_-2px_0_var(--color-gold)]' : 'font-normal text-muted-ink',
              )}
            >{t.label}</button>
          );
        })}
      </div>

      {error && tab !== 'users' && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* ------------------------------ Users tab ------------------------------ */}
      {tab === 'users' && (
        <DataTable<Row>
          id="users" columns={columns} rows={data ? rows : null} rowKey={u => u.id}
          loading={loading} error={error} onRetry={reload} onRowClick={canManage ? openEdit : undefined}
          pageSize={0} noun={['account', 'accounts']} exportName="users"
          header={
            <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink">
              Role sets what a person can do. The reporting line is separate — see the organisation chart.
            </div>
          }
          empty={{ title: 'No accounts yet.', icon: 'Users' }}
          renderCard={u => {
            const s = status(u);
            return (
              <span className="flex items-center gap-3 min-w-0">
                <span className={cx('w-[32px] h-[32px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>
                  {initials(u.fullName)}
                </span>
                <span className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="text-copy font-medium truncate" title={u.fullName}>{u.fullName}</span>
                  {jobLine(u) && <span className="text-meta text-ink truncate" title={jobLine(u)}>{jobLine(u)}</span>}
                  <span className="text-meta text-muted-ink truncate" title={u.email}>{u.email}</span>
                  <span className="flex items-center gap-1.5 flex-wrap"><StatusBadge tone={roleTone[u.role]} label={roleLabel(u.role)} size="sm" /><StatusBadge tone={s.tone} label={s.label} size="sm" /></span>
                  {isInvited(u) && <InviteCell u={u} onResend={canManage ? () => confirmResend(u) : undefined} />}
                </span>
                <RowActions name={u.fullName} items={actionsFor(u)} />
              </span>
            );
          }}
        />
      )}

      {/* ----------------------------- Sign-ins tab ----------------------------- */}
      {tab === 'signins' && canManage && <UsersSignIns people={rows.map(r => ({ id: r.id, fullName: r.fullName }))} />}

      {/* --------------------------- Permissions tab --------------------------- */}
      {tab === 'permissions' && <PermissionsChart />}

      {/* --------------------------- Organisation tab -------------------------- */}
      {tab === 'org' && (
        <Card>
          <div className="p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-meta text-muted-ink max-w-[640px] leading-[1.5]">
                Reporting line, not a permission source. It drives escalation and rosters. Permissions come from the role on each account — see the Permissions tab.
              </span>
              <Button variant="secondary" size="sm" onClick={openOrg}>Edit structure</Button>
            </div>
            <OrgChart staff={staff.filter(s => s.isActive)} nameById={nameById} />
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
              <Button variant="primary" size="sm" type="submit" form="invite-form" loading={busy}>Send invitation</Button>
            </>
          }
        >
          <form id="invite-form" onSubmit={submitInvite} className="flex flex-col gap-4">
            <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" error={fieldErrors.fullName} />
            <Field label="Work email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@theconts.com" error={fieldErrors.email} />
            {jobFields && <JobFields department={department} position={position} onDepartment={setDepartment} onPosition={setPosition}
              errors={fieldErrors} departments={departmentOptions} positions={positionsFor(department)} departmentOf={departmentOf} />}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
              <Select label="Role" showLabel size="md" value={role} onChange={v => setRole(v as UserRole)} options={STAFF_ROLE_OPTIONS} />
              {role !== 'owner' && (
                <Select label="Reports to" showLabel size="md" value={managerId} onChange={setManagerId} placeholder="No manager"
                  options={managerOptions(staff)} />
              )}
            </div>
            <div className="text-meta text-muted-ink leading-[1.5]">
              The role sets their permissions and landing screen. The reporting line is for escalation and rosters only. Owners are invited from their own record under Owners.
            </div>
          </form>
          {lastTempPassword && (
            <div className="mt-4 py-3 px-3.5 rounded-control bg-page border border-solid border-line">
              <div className="text-meta text-muted-ink">Temporary password for {lastTempPassword.name}</div>
              <div className="text-heading font-semibold font-mono mt-1">{lastTempPassword.password}</div>
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
              <Button variant="primary" size="sm" type="submit" form="edit-form" loading={busy}>Save changes</Button>
            </>
          }
        >
          <form id="edit-form" onSubmit={submitEdit} className="flex flex-col gap-4">
            <Field label="Full name" value={editName} onChange={e => setEditName(e.target.value)} error={editErrors.fullName} />
            <Field label="Email" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} error={editErrors.email} />
            <PhoneInput label="Phone" value={editPhone} onChange={setEditPhone} error={editErrors.phone} />
            {jobFields && <JobFields department={editDepartment} position={editPosition} onDepartment={setEditDepartment} onPosition={setEditPosition}
              errors={editErrors} departments={departmentOptions} positions={positionsFor(editDepartment)} departmentOf={departmentOf} />}
            <div className="flex flex-col gap-1.5">
              <Select label="Role" showLabel size="md" value={editRole} onChange={v => setEditRole(v as UserRole)}
                options={editing.role === 'owner' ? ROLE_OPTIONS.filter(o => o.value === 'owner') : STAFF_ROLE_OPTIONS} disabled={editing.role === 'owner'} />
              {editRole !== editing.role && (
                <span className={cx('text-meta', TONE.warning.text)}>
                  Changing the role rebuilds this person’s navigation and permissions on their next sign-in.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Select label="Reports to" showLabel size="md" value={editManager} onChange={setEditManager} placeholder="No manager"
                options={managerOptions(staff, editing.id, editing.managerId)} />
              <span className="text-meta text-muted-ink">Reporting line only. It does not grant or remove any access.</span>
            </div>
            <label htmlFor="ed-active" className="flex items-center gap-2 cursor-pointer">
              <input id="ed-active" type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-copy">Account is active</span>
            </label>
          </form>
          <div className="mt-4"><HistoryDisclosure entity="users" id={editing.id} /></div>
        </Modal>
      )}

      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />

      {resetLink && (
        <Modal
          title={`Reset link for ${resetLink.email}`}
          sub="For when the reset email cannot reach them. Send it to the person directly; it works once and expires in 60 minutes. It is shown only now."
          onClose={() => setResetLink(null)}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={copyResetLink}>Copy link</Button>
              <Button variant="primary" size="sm" onClick={() => setResetLink(null)}>Done</Button>
            </>
          }
        >
          <input readOnly value={resetLink.link} aria-label="Reset link" onFocus={e => e.currentTarget.select()}
            className="w-full box-border rounded-control border border-solid border-line bg-page px-2.5 py-2 font-mono text-caption" />
        </Modal>
      )}

      {tempShown && (
        <Modal
          title={`Temporary password for ${tempShown.name}`}
          sub="Give this to them in person or by a private message. It is shown only now; close this box and it cannot be seen again."
          onClose={() => setTempShown(null)}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => {
                navigator.clipboard?.writeText(tempShown.password).then(
                  () => toast({ tone: 'success', title: 'Copied.' }),
                  () => toast({ tone: 'warning', title: 'Could not copy. Select the password and copy it by hand.' }));
              }}>Copy password</Button>
              <Button variant="primary" size="sm" onClick={() => setTempShown(null)}>Done</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="py-3 px-3.5 rounded-control bg-page border border-solid border-line">
              <div className="text-meta text-muted-ink">Sign in as {tempShown.email} with</div>
              <div className="text-heading font-semibold font-mono mt-1 select-all break-all">{tempShown.password}</div>
            </div>
            <span className="text-meta text-muted-ink leading-[1.5]">
              They have been signed out on every device. When they sign in with this, they must choose their own password before they can do anything else.
            </span>
          </div>
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
              <Button variant="primary" size="sm" type="submit" form="org-form" loading={busy}>Save structure</Button>
            </>
          }
        >
          <form id="org-form" onSubmit={submitOrg} className="flex flex-col gap-3">
            {staff.map(s => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 items-center">
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis">{s.fullName}</span>
                  <span className="text-caption text-muted-ink">{roleLabel(s.role)}</span>
                </div>
                <Select label={`Manager for ${s.fullName}`} size="md" value={orgDraft[s.id] ?? ''}
                  onChange={v => setOrgDraft(d => ({ ...d, [s.id]: v }))} placeholder="No manager"
                  options={staff.filter(o => o.id !== s.id).map(o => ({ value: o.id, label: o.fullName }))} />
              </div>
            ))}
          </form>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------ row actions ------------------------------ */
/** Department, then position: pick a suggestion or type a new one, in the same dropdown as Role and Reports to.
 *  The position list follows the department; with no department yet it lists every position under its department,
 *  and picking one fills the department in ("3D Designer" means Design). Shown after the person's name in renovation pickers. */
function JobFields({ department, position, onDepartment, onPosition, errors, departments, positions, departmentOf }: {
  department: string; position: string; onDepartment: (v: string) => void; onPosition: (v: string) => void;
  errors: { department?: string; position?: string }; departments: string[]; positions: string[];
  departmentOf: (position: string) => string | null;
}) {
  const pickPosition = (v: string) => {
    onPosition(v);
    const d = departmentOf(v);
    // A department someone typed that is not on any list stays as they wrote it.
    if (d && !sameText(d, department) && (!department.trim() || departments.some(x => sameText(x, department)))) onDepartment(d);
  };
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <SearchSelect label="Department" showLabel size="md" allowNew allLabel="Not set" value={department} onChange={onDepartment}
        options={departments.map(v => ({ value: v, label: v }))} placeholder="Search or type a department" error={errors.department} />
      <SearchSelect label="Position" showLabel size="md" allowNew allLabel="Not set" value={position} onChange={pickPosition}
        options={positions.map(v => ({ value: v, label: v, group: department.trim() ? undefined : departmentOf(v) ?? 'Other' }))}
        placeholder="Search or type a position" error={errors.position} />
    </div>
  );
}

/* --------------------------- org chart render --------------------------- */
function OrgChart({ staff, nameById }: { staff: Row[]; nameById: Record<string, string> }) {
  // Grouped by each person's place in the reporting line, not by how deep they sit: someone with no
  // manager set is not leadership unless people report to them. `staff` is active accounts only.
  const directReports = (id: string) => staff.filter(s => s.managerId === id).length;
  const hasManager = (u: Row) => !!u.managerId && staff.some(s => s.id === u.managerId);

  const levels: { label: string; people: Row[] }[] = [
    { label: 'Leadership', people: [] },
    { label: 'Managers', people: [] },
    { label: 'Team', people: [] },
  ];
  for (const u of staff) {
    levels[directReports(u.id) === 0 ? 2 : hasManager(u) ? 1 : 0].people.push(u);
  }

  return (
    <div className="flex flex-col gap-5">
      {levels.filter(l => l.people.length).map(l => (
        <div key={l.label} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-caption font-semibold tracking-[0.06em] uppercase text-muted-ink">{l.label}</span>
            <span className="flex-1 h-px bg-[var(--color-line-soft)]" />
          </div>
          <div className="flex gap-3 flex-wrap">
            {l.people.map(p => {
              const reports = directReports(p.id);
              const manager = p.managerId ? nameById[p.managerId] : null;
              const meta = reports > 0
                ? plural(reports, 'direct report')
                : manager ? `Reports to ${manager}` : 'No manager set';
              return (
                <div key={p.id} className={cx('min-w-[188px] py-3 px-4 rounded-card border border-solid border-line bg-card flex flex-col gap-2', ORG_ACCENT[roleTone[p.role]])}>
                  <div className="flex items-center gap-2.5">
                    <span className={cx('w-8 h-8 flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[roleTone[p.role]].bg, TONE[roleTone[p.role]].text)}>
                      {initials(p.fullName)}
                    </span>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-semibold whitespace-nowrap">{p.fullName}</span>
                      <span className="text-caption text-muted-ink whitespace-nowrap">{roleLabel(p.role)}</span>
                    </div>
                  </div>
                  {meta && <span className="text-caption text-muted-ink">{meta}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
