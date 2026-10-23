import { useMemo, useRef, useState, type FormEvent } from 'react';
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
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import UserAccess from '../components/permissions/UserAccess';
import { KIND_NOTE, sideLabel, useDepartments } from '../components/permissions/shared';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { count, date, plural } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Department, Tone, UserRole } from '../lib/types';
import { HistoryDisclosure } from '../components/RecordHistory';
import { RowActions, type RowAction } from '../components/RowActions';
import { deliveryToast } from '../lib/emailDelivery';
import Icon from '../components/Icon';

/* ------------------------------------------------------------------ *
 * Users and roles — three tabs (routes.json → SYSTEM → UsersPage):
 *   1. Users        — list with department, position and reporting line; invite + edit.
 *   2. Permissions  — three views (components/PermissionsChart): what each department and position can do
 *                     in each area, and the managed list of departments and positions.
 *   3. Organisation — the reporting line (manager_id). Explicitly NOT a
 *                     permission source; permissions come from the department, position and the person's own settings.
 *   4. Sign-ins     — management only: every sign-in attempt (UsersSignIns).
 * There is no backend in dev, so every mutation is applied to a local
 * overlay first and the real call is attempted in a swallowed try/catch.
 * ------------------------------------------------------------------ */

// The role is worked out by the server from the department's kind and is shown nowhere. A person's colour comes from
// their department instead: a stable pick from these four, so the same department always looks the same.
const AVATAR_TONES: Tone[] = ['info', 'success', 'warning', 'neutral'];
function avatarTone(u: Pick<Row, 'department' | 'role'>): Tone {
  const name = (u.department ?? '').trim().toLowerCase();
  if (!name) return 'neutral';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

interface Row {
  id: string; fullName: string; email: string; phone: string | null; role: UserRole;
  department?: string | null; position?: string | null; departmentId?: string | null; positionId?: string | null;
  managerId: string | null;
  isActive: boolean; mustChangePassword: boolean; isLocked?: boolean; twoStep?: boolean; lastLoginAt: string | null;
  /** When the newest invitation email went out (audit_log user.invite / user.resend_invite). */
  lastInvitedAt?: string | null;
}
interface Payload { data: Row[]; generatedAt: string }

/** The departments and positions come from the managed list (Permissions > Departments and positions), so nothing is typed
 *  here. The department's side is the person's side: the other side's screens stay closed for them. */
const departmentNote = (d: Department | undefined): string | null => {
  if (!d) return null;
  const note = KIND_NOTE[d.kind];
  return `Works on ${sideLabel(d.side)}.${note ? ` ${note}` : ''}`;
};

/** "Position · Department", skipping what is not set. */
const jobLine = (u: Pick<Row, 'department' | 'position'>) => [u.position, u.department].map(v => (v ?? '').trim()).filter(Boolean).join(' · ');

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'u1', fullName: 'Lee Wei Siang', email: 'management@theconts.com', phone: '+60 12-345 6702', role: 'management', department: 'Management', position: 'Director', managerId: null, isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u2', fullName: 'Aina Zulkifli', email: 'aina@theconts.com', phone: '+60 12-345 6701', role: 'operations_staff', department: 'Operations', position: 'Operations Manager', managerId: 'u1', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u4', fullName: 'Priya Devi', email: 'finance@theconts.com', phone: '+60 12-345 6703', role: 'operations_staff', department: 'Finance', position: 'Finance Admin', managerId: 'u1', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u3', fullName: 'Chan Wei Wen', email: 'weiwen@theconts.com', phone: '+60 12-345 6704', role: 'operations_staff', department: 'Admin', position: 'Admin', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-15' },
    { id: 'u5', fullName: 'Nurul Huda', email: 'nurul@theconts.com', phone: '+60 12-345 6705', role: 'housekeeper', department: 'Cleaning', position: 'Cleaner', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u6', fullName: 'Faridah Ismail', email: 'faridah@theconts.com', phone: '+60 12-345 6706', role: 'housekeeper', department: 'Cleaning', position: 'Cleaner', managerId: 'u2', isActive: true, mustChangePassword: true, lastLoginAt: null },
    { id: 'u7', fullName: 'Hafiz Omar', email: 'hafiz@theconts.com', phone: '+60 12-345 6707', role: 'technician', department: 'Maintenance', position: 'Technician', managerId: 'u2', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-14' },
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
  // The managed departments and positions (Permissions > Departments and positions) feed the forms and the side label.
  const { user: me } = useSession();
  const canManage = me?.role === 'management';
  const { data: deptData } = useDepartments(canManage);
  const departments = useMemo(() => deptData?.departments ?? [], [deptData]);
  const departmentById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);
  // A row from before the managed list has only the text, so it is matched by name.
  const departmentOfRow = useMemo(() => (u: Row) => (u.departmentId ? departmentById.get(u.departmentId) : undefined) ?? departments.find(x => x.name === u.department), [departmentById, departments]);
  const sideOf = useMemo(() => (u: Row) => {
    const d = departmentOfRow(u);
    return d ? sideLabel(d.side) : null;
  }, [departmentOfRow]);

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'name', label: 'Name', value: u => u.fullName, hideable: false, width: 220,
      render: u => (
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={cx('w-[30px] h-[30px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[avatarTone(u)].bg, TONE[avatarTone(u)].text)}>
            {initials(u.fullName)}
          </span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={u.fullName}>{u.fullName}</span>
            <span className="text-caption text-muted-ink whitespace-nowrap">{u.phone || '—'}</span>
          </span>
        </span>
      ) },
    // The department's side shows under its name: a person's side is their department's side.
    { key: 'department', label: 'Department', value: u => u.department || null, width: 160,
      render: u => {
        const side = u.role === 'owner' ? null : sideOf(u);
        return u.department ? (
          <span className="flex flex-col gap-px min-w-0" title={side ? `${u.department}, works on ${side}` : u.department}>
            <span className="text-copy whitespace-nowrap overflow-hidden text-ellipsis">{u.department}</span>
            {side && <span className="text-caption text-muted-ink whitespace-nowrap">{side}</span>}
          </span>
        ) : <span className="text-copy text-muted-ink">—</span>;
      } },
    { key: 'position', label: 'Position', value: u => u.position || null, width: 160 },
    { key: 'email', label: 'Email', value: u => u.email, width: 210 },
    { key: 'phone', label: 'Phone', type: 'phone', value: u => u.phone || null, hidden: true, width: 140 },
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
  ], [nameById, sideOf]);
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
  const [managerId, setManagerId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastTempPassword, setLastTempPassword] = useState<{ name: string; password: string } | null>(null);

  function resetInvite() {
    setInviteOpen(false); setFullName(''); setEmail('');
    setManagerId(''); setDepartmentId(''); setPositionId(''); setFieldErrors({}); setBusy(false);
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Enter a full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = 'Enter a valid work email.';
    if (rows.some(r => r.email.toLowerCase() === email.trim().toLowerCase())) errs.email = 'That email already has an account.';
    if (!departmentId) errs.departmentId = 'Pick a department.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setBusy(true); setFieldErrors({});
    try {
      const res = await api.post<{ id: string; delivery: string; reason?: string }>('/users', {
        fullName: fullName.trim(), email: email.trim(), departmentId, positionId: positionId || null, managerId: managerId || null,
      });
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
  const [editManager, setEditManager] = useState<string>('');
  const [editActive, setEditActive] = useState(true);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDepartmentId, setEditDepartmentId] = useState('');
  const [editPositionId, setEditPositionId] = useState('');
  const [editErrors, setEditErrors] = useState<{ fullName?: string; email?: string; phone?: string; departmentId?: string; positionId?: string }>({});

  function openEdit(u: Row) {
    const d = departmentOfRow(u);
    const p = d?.positions.find(x => x.id === u.positionId) ?? d?.positions.find(x => x.name === u.position);
    setEditing(u); setEditManager(u.managerId ?? ''); setEditActive(u.isActive);
    setEditName(u.fullName); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditDepartmentId(d?.id ?? ''); setEditPositionId(p?.id ?? ''); setEditErrors({});
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

  const editPlaceChanged = !!editing && (editDepartmentId !== (departmentOfRow(editing)?.id ?? '') || editPositionId !== (editing.positionId ?? ''));
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    const errs: { fullName?: string; email?: string; phone?: string } = {};
    if (!editName.trim()) errs.fullName = 'Enter a name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editEmail)) errs.email = 'Enter a valid email address.';
    // Only owners have a phone here; staff are invited without one, so their edit form matches.
    const isOwner = editing.role === 'owner';
    const phoneErr = isOwner ? phoneProblem(editPhone) : null;
    if (phoneErr) errs.phone = phoneErr;
    // An owner has no department; a staff account must keep one.
    const noDepartment = !isOwner && !editDepartmentId;
    if (Object.keys(errs).length || noDepartment) { setEditErrors({ ...errs, ...(noDepartment ? { departmentId: 'Pick a department.' } : {}) }); return; }

    setBusy(true); setEditErrors({});
    const editedDept = departmentById.get(editDepartmentId);
    const editedPosition = editedDept?.positions.find(p => p.id === editPositionId);
    const placeChanged = !isOwner && (editDepartmentId !== (departmentOfRow(editing)?.id ?? '') || editPositionId !== (editing.positionId ?? ''));
    const patch = {
      managerId: editManager || null, isActive: editActive,
      fullName: editName.trim(), email: editEmail.trim().toLowerCase(),
      ...(isOwner ? { phone: editPhone.trim() || null } : { departmentId: editDepartmentId, positionId: editPositionId || null }),
    };
    try {
      await api.patch(`/users/${editing.id}`, patch);
      setEdits(m => ({ ...m, [editing.id]: {
        ...m[editing.id], managerId: patch.managerId, isActive: patch.isActive, fullName: patch.fullName, email: patch.email,
        ...(isOwner ? { phone: editPhone.trim() || null } : { departmentId: editDepartmentId, positionId: editPositionId || null, department: editedDept?.name ?? null, position: editedPosition?.name ?? null }),
      } }));
      toast({
        tone: 'success',
        title: `${editName.trim()} updated.`,
        body: placeChanged
          ? 'Department or position changed. Their access follows it straight away, on their next click.'
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
              Department and position set what a person can do. The reporting line is separate: see the organisation chart.
            </div>
          }
          empty={{ title: 'No accounts yet.', icon: 'Users' }}
          renderCard={u => {
            const s = status(u);
            return (
              <span className="flex items-center gap-3 min-w-0">
                <span className={cx('w-[32px] h-[32px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[avatarTone(u)].bg, TONE[avatarTone(u)].text)}>
                  {initials(u.fullName)}
                </span>
                <span className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="text-copy font-medium truncate" title={u.fullName}>{u.fullName}</span>
                  {jobLine(u) && <span className="text-meta text-ink truncate" title={jobLine(u)}>{jobLine(u)}</span>}
                  <span className="text-meta text-muted-ink truncate" title={u.email}>{u.email}</span>
                  <span className="flex items-center gap-1.5 flex-wrap">{sideOf(u) && u.role !== 'owner' && <StatusBadge tone="neutral" label={sideOf(u) ?? ''} size="sm" />}<StatusBadge tone={s.tone} label={s.label} size="sm" /></span>
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
                Reporting line, not a permission source. It drives escalation and rosters. Permissions come from the department and position on each account: see the Permissions tab.
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
            <PlaceFields departments={departments} departmentId={departmentId} positionId={positionId}
              onDepartment={v => { setDepartmentId(v); setPositionId(''); }} onPosition={setPositionId}
              errors={{ departmentId: fieldErrors.departmentId, positionId: fieldErrors.positionId }} />
            <Select label="Reports to" showLabel size="md" value={managerId} onChange={setManagerId} placeholder="No manager"
              options={managerOptions(staff)} />
            <div className="text-meta text-muted-ink leading-[1.5]">
              The department and position set their permissions, and the department sets which side they work on. The reporting line is for escalation and rosters only. Owners are invited from their own record under Owners.
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
          width={editing.role === 'owner' ? 460 : 640}
          title={`Edit ${editing.fullName}`}
          sub="Change the department, position, reporting line or status."
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
            {editing.role === 'owner' && <PhoneInput label="Phone" value={editPhone} onChange={setEditPhone} error={editErrors.phone} />}
            {editing.role !== 'owner' && <PlaceFields departments={departments} departmentId={editDepartmentId} positionId={editPositionId}
              onDepartment={v => { setEditDepartmentId(v); setEditPositionId(''); }} onPosition={setEditPositionId}
              errors={{ departmentId: editErrors.departmentId, positionId: editErrors.positionId }} />}
            {editing.role !== 'owner' && editPlaceChanged && (
              <span className={cx('text-meta', TONE.warning.text)}>
                Changing the department or position changes this person’s permissions and menu on their next click.
              </span>
            )}
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
          <div className="mt-4 flex flex-col gap-3">
            {editing.role !== 'owner' && <UserAccess key={editing.id} userId={editing.id} />}
            <HistoryDisclosure entity="users" id={editing.id} />
          </div>
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
                  <span className="text-caption text-muted-ink">{jobLine(s) || 'No department'}</span>
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

/* ------------------------------ forms ------------------------------ */
/** Department (required), then position (optional), both from the managed list. The department's side shows beneath,
 *  because a person's side is their department's side. A position belongs to one department, so changing the
 *  department clears the position. */
function PlaceFields({ departments, departmentId, positionId, onDepartment, onPosition, errors }: {
  departments: Department[]; departmentId: string; positionId: string;
  onDepartment: (id: string) => void; onPosition: (id: string) => void;
  errors: { departmentId?: string; positionId?: string };
}) {
  const dept = departments.find(d => d.id === departmentId);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <div className="flex flex-col gap-1">
          <Select label="Department" showLabel size="md" value={departmentId} onChange={onDepartment} placeholder="Pick a department"
            options={departments.map(d => ({ value: d.id, label: d.name }))} />
          {errors.departmentId && <span className={cx('text-meta', TONE.critical.text)}>{errors.departmentId}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <Select label="Position" showLabel size="md" value={positionId} onChange={onPosition} placeholder="No position" disabled={!dept || dept.positions.length === 0}
            options={(dept?.positions ?? []).map(p => ({ value: p.id, label: p.name }))} />
          {errors.positionId && <span className={cx('text-meta', TONE.critical.text)}>{errors.positionId}</span>}
        </div>
      </div>
      {dept && <span className="text-meta text-muted-ink">{departmentNote(dept)}</span>}
      {departments.length === 0 && <span className="text-meta text-muted-ink">No departments yet. Add them under the Permissions tab, under Departments and positions.</span>}
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
                <div key={p.id} className={cx('min-w-[188px] py-3 px-4 rounded-card border border-solid border-line bg-card flex flex-col gap-2', ORG_ACCENT[avatarTone(p)])}>
                  <div className="flex items-center gap-2.5">
                    <span className={cx('w-8 h-8 flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[avatarTone(p)].bg, TONE[avatarTone(p)].text)}>
                      {initials(p.fullName)}
                    </span>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-semibold whitespace-nowrap">{p.fullName}</span>
                      <span className="text-caption text-muted-ink whitespace-nowrap" title={jobLine(p)}>{jobLine(p) || 'No department'}</span>
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
