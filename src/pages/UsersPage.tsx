import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import PermissionsChart from '../components/PermissionsChart';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { count, date, plural } from '../lib/format';
import { ROLE_LABEL } from '../lib/vocabulary';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone, UserRole } from '../lib/types';
import { PhoneText } from '../components/PhoneText';

/* ------------------------------------------------------------------ *
 * Users and roles — three tabs (routes.json → SYSTEM → UsersPage):
 *   1. Users        — list with role + reporting line; invite + edit.
 *   2. Permissions  — the editable chart (components/PermissionsChart): what each
 *                     office role can do in each area, saved to role_access.
 *   3. Organisation — the reporting line (manager_id). Explicitly NOT a
 *                     permission source; permissions come from the role.
 * There is no backend in dev, so every mutation is applied to a local
 * overlay first and the real call is attempted in a swallowed try/catch.
 * ------------------------------------------------------------------ */

// Seven roles the server accepts (functions/api/users ROLES), highest to
// lowest access so a picker reads top-down.
const ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician', 'owner'];
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
const ROLE_OPTIONS = ROLES.map(r => ({ value: r, label: roleLabel(r) }));
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

/* ------------------------------- styles ------------------------------- */
const LIST_COLS_CLASS = 'grid-cols-[minmax(180px,1.6fr)_minmax(180px,1.4fr)_150px_140px_120px_110px]';
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[rgba(21,21,21,0.44)] animate-[fade-in_var(--motion-standard)_var(--ease-out)_both]">
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
  const [managerId, setManagerId] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastTempPassword, setLastTempPassword] = useState<{ name: string; password: string } | null>(null);

  function resetInvite() {
    setInviteOpen(false); setFullName(''); setEmail(''); setRole('operations_staff');
    setManagerId(''); setFieldErrors({}); setBusy(false);
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
      toast({ tone: 'critical', title: 'Could not re-send the invitation.', body: errorMessage(err, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  // A one-time reset link shown here once, for management to pass on by WhatsApp or in person when the
  // reset email cannot reach the person. See functions/api/users/[id]/reset-link.ts.
  const [resetLink, setResetLink] = useState<{ link: string; expiresAt: string; email: string } | null>(null);
  async function makeResetLink() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ link: string; expiresAt: string; email: string }>(`/users/${editing.id}/reset-link`, {});
      setResetLink(res);
    } catch (err) {
      toast({ tone: 'critical', title: 'Could not make a reset link.', body: errorMessage(err, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  async function copyResetLink() {
    if (!resetLink) return;
    try { await navigator.clipboard.writeText(resetLink.link); toast({ tone: 'success', title: 'Reset link copied.', body: 'Send it to the person directly. It works once and expires in 60 minutes.' }); }
    catch { toast({ tone: 'warning', title: 'Copy did not work.', body: 'Select the link and copy it by hand.' }); }
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
      fullName: editName.trim(), email: editEmail.trim().toLowerCase(), phone: editPhone.trim() || null,
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
  ];

  return (
    <>
      <PageHeader
        title="Users and roles"
        sub={`${plural(rows.length, 'account')} · ${count(invitedCount)} invited and not yet signed in`}
        primary={tab === 'users' && (
          <Button variant="primary" size="sm" onClick={() => { setLastTempPassword(null); setInviteOpen(true); }}>
            Invite user
          </Button>
        )}
      />

      <div role="tablist" aria-label="Users and roles sections" className="flex shrink-0 gap-1 [border-bottom:1px_solid_var(--color-line)] overflow-x-auto mt-0.5">
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

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* ------------------------------ Users tab ------------------------------ */}
      {tab === 'users' && (
        <Card>
          <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line)] flex items-center justify-between gap-3 flex-wrap">
            <span className="text-meta text-muted-ink">Role sets what a person can do. The reporting line is separate — see the organisation chart.</span>
          </div>
          {/* Phones: one stacked row per person instead of a 940px table that hides role and status off-screen. */}
          <div className="sm:hidden">
            {loading && rows.length === 0 ? <TableSkeleton rows={5} cols={2} /> : rows.map(u => {
              const s = status(u);
              return (
                <button key={u.id} onClick={() => openEdit(u)}
                  className="flex items-center gap-3 w-full text-left py-3 px-4 bg-transparent border-none rounded-none cursor-pointer [font:inherit] [border-bottom:1px_solid_var(--color-line-soft)]">
                  <span className={cx('w-[32px] h-[32px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>
                    {initials(u.fullName)}
                  </span>
                  <span className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="text-copy font-medium truncate" title={u.fullName}>{u.fullName}</span>
                    <span className="text-meta text-muted-ink truncate" title={u.email}>{u.email}</span>
                    <span className="flex items-center gap-1.5 flex-wrap"><StatusBadge tone={roleTone[u.role]} label={roleLabel(u.role)} size="sm" /><StatusBadge tone={s.tone} label={s.label} size="sm" /></span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="overflow-x-auto max-sm:hidden">
            <div className="min-w-[940px]">
              <div className={cx('grid', LIST_COLS_CLASS, 'gap-3.5 py-2.5 px-5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-meta font-semibold text-muted-ink')}>
                <div>Name</div><div>Email</div><div>Role</div><div>Reports to</div><div>Last sign-in</div><div>Status</div>
              </div>
              {loading && rows.length === 0 ? <TableSkeleton rows={7} cols={6} /> : rows.map(u => {
                const s = status(u);
                const manager = u.managerId ? nameById[u.managerId] : null;
                return (
                  <button
                    key={u.id}
                    onClick={() => openEdit(u)}
                    className={cx('grid', LIST_COLS_CLASS, 'gap-3.5 items-center w-full text-left min-h-[50px] py-2 px-5 bg-transparent border-none rounded-none cursor-pointer [font:inherit] [border-bottom:1px_solid_var(--color-line-soft)]')}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className={cx('w-[30px] h-[30px] flex-none rounded-full grid place-items-center text-caption font-semibold', TONE[roleTone[u.role]].bg, TONE[roleTone[u.role]].text)}>
                        {initials(u.fullName)}
                      </span>
                      <span className="flex flex-col gap-px min-w-0">
                        <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={u.fullName}>{u.fullName}</span>
                        <PhoneText value={u.phone} className="text-caption text-muted-ink" empty="" />
                      </span>
                    </span>
                    <span className="text-copy text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={u.email}>{u.email}</span>
                    <span><StatusBadge tone={roleTone[u.role]} label={roleLabel(u.role)} size="sm" /></span>
                    <span className={cx('text-copy whitespace-nowrap overflow-hidden text-ellipsis', manager ? 'text-ink' : 'text-faint')}>{manager ?? '—'}</span>
                    <span className="text-copy text-muted-ink">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</span>
                    <span><StatusBadge tone={s.tone} label={s.label} /></span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

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
          <form id="invite-form" onSubmit={submitInvite} className="flex flex-col gap-4">
            <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" error={fieldErrors.fullName} />
            <Field label="Work email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@theconts.com" error={fieldErrors.email} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
              <Select label="Role" showLabel size="md" value={role} onChange={v => setRole(v as UserRole)} options={ROLE_OPTIONS} />
              {role !== 'owner' && (
                <Select label="Reports to" showLabel size="md" value={managerId} onChange={setManagerId} placeholder="No manager"
                  options={staff.map(s => ({ value: s.id, label: s.fullName }))} />
              )}
            </div>
            <div className="text-meta text-muted-ink leading-[1.5]">
              The role sets their permissions and landing screen. The reporting line is for escalation and rosters only.
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
          onClose={() => { setEditing(null); setResetLink(null); }}
          footer={
            <>
              {status(editing).label === 'Invited' && (
                <Button variant="secondary" size="sm" onClick={resendInvite} disabled={busy}>Resend invitation</Button>
              )}
              {status(editing).label !== 'Invited' && editing.isActive && (
                <Button variant="secondary" size="sm" onClick={makeResetLink} disabled={busy}>Reset link</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" form="edit-form" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </>
          }
        >
          {resetLink && (
            <div className="mb-4 flex flex-col gap-2 rounded-[8px] bg-[var(--color-surface-sunken)] p-3">
              <div className="text-meta font-semibold">Reset link for {resetLink.email}</div>
              <div className="text-caption text-muted-ink">Shown once. Send it to the person directly; it works one time and expires in 60 minutes.</div>
              <input readOnly value={resetLink.link} onFocus={e => e.currentTarget.select()} className="w-full rounded-[6px] border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-caption" />
              <div><Button variant="secondary" size="sm" type="button" onClick={copyResetLink}>Copy link</Button></div>
            </div>
          )}
          <form id="edit-form" onSubmit={submitEdit} className="flex flex-col gap-4">
            <Field label="Full name" value={editName} onChange={e => setEditName(e.target.value)} error={editErrors.fullName} />
            <Field label="Email" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} error={editErrors.email} />
            <Field label="Phone" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+60 12-345 6789" />
            <div className="flex flex-col gap-1.5">
              <Select label="Role" showLabel size="md" value={editRole} onChange={v => setEditRole(v as UserRole)} options={ROLE_OPTIONS} />
              {editRole !== editing.role && (
                <span className={cx('text-meta', TONE.warning.text)}>
                  Changing the role rebuilds this person’s navigation and permissions on their next sign-in.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Select label="Reports to" showLabel size="md" value={editManager} onChange={setEditManager} placeholder="No manager"
                options={staff.filter(s => s.id !== editing.id).map(s => ({ value: s.id, label: s.fullName }))} />
              <span className="text-meta text-muted-ink">Reporting line only. It does not grant or remove any access.</span>
            </div>
            <label htmlFor="ed-active" className="flex items-center gap-2 cursor-pointer">
              <input id="ed-active" type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-copy">Account is active</span>
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
            <span className="text-caption font-semibold tracking-[0.06em] uppercase text-muted-ink">{l.label}</span>
            <span className="flex-1 h-px bg-[var(--color-line-soft)]" />
          </div>
          <div className="flex gap-3 flex-wrap">
            {l.people.map(p => {
              const reports = directReports(p.id);
              const manager = p.managerId ? nameById[p.managerId] : null;
              const meta = reports > 0
                ? plural(reports, 'direct report')
                : manager ? `Reports to ${manager}` : null;
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
