import { useState, type FormEvent } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import type { UserRole } from '../lib/types';

// Same 7 values the server accepts (functions/api/users/index.ts ROLES) — kept
// in this order so the picker reads highest to lowest access, matching how the
// list itself is understood.
const ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician', 'owner'];
const roleLabel = (r: string) => r.replace(/_/g, ' ');

interface Row {
  id: string; fullName: string; email: string; role: UserRole;
  isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null;
}
interface Payload { data: Row[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'u1', fullName: 'Lee Wei Siang', email: 'management@theconts.com', role: 'management', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u2', fullName: 'Aina Zulkifli', email: 'aina@theconts.com', role: 'operations_manager', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u3', fullName: 'Chan Wei Wen', email: 'weiwen@theconts.com', role: 'operations_staff', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-15' },
    { id: 'u4', fullName: 'Priya Devi', email: 'finance@theconts.com', role: 'finance_admin', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u5', fullName: 'Nurul Huda', email: 'nurul@theconts.com', role: 'housekeeper', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-16' },
    { id: 'u6', fullName: 'Faridah Ismail', email: 'faridah@theconts.com', role: 'housekeeper', isActive: true, mustChangePassword: true, lastLoginAt: null },
    { id: 'u7', fullName: 'Hafiz Omar', email: 'hafiz@theconts.com', role: 'technician', isActive: true, mustChangePassword: false, lastLoginAt: '2026-09-14' },
  ],
};

const COLS = 'minmax(170px,1.5fr) minmax(200px,1.7fr) minmax(150px,1.3fr) minmax(100px,0.9fr) minmax(110px,0.9fr)';

/** Invited but never signed in is a distinct state from active — an account
 *  sitting on a temporary password is a security item, not a neutral one. */
function status(u: Row) {
  if (!u.isActive) return { label: 'Inactive', tone: 'neutral' as const };
  if (u.mustChangePassword && !u.lastLoginAt) return { label: 'Invited', tone: 'warning' as const };
  return { label: 'Active', tone: 'success' as const };
}

const input = {
  display: 'block', width: '100%', boxSizing: 'border-box' as const, height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const label = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/users', FALLBACK);
  const toast = useToast();
  const rows = data?.data ?? [];
  const invited = rows.filter(r => status(r).label === 'Invited').length;

  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operations_staff');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function closeForm() {
    setInviting(false); setFullName(''); setEmail(''); setRole('operations_staff'); setFieldErrors({});
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setFieldErrors({});
    try {
      await api.post('/users', { fullName, email, role });
      toast({ tone: 'success', title: `Invitation sent to ${fullName}.`, body: `They'll receive a temporary password by email and set their own on first sign-in.` });
      closeForm();
      reload();
    } catch (e) {
      if (e instanceof ApiFailure) {
        setFieldErrors(e.fields ?? {});
        toast({ tone: 'critical', title: 'Could not send the invitation.', body: e.message });
      } else {
        toast({ tone: 'critical', title: 'Could not send the invitation.', body: 'Try again in a moment.' });
      }
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Users and roles" sub={`${rows.length} accounts &middot; ${invited} invited and not yet signed in`}
        right={!inviting && (
          <button onClick={() => setInviting(true)}
            style={{ height: 38, padding: '0 16px', borderRadius: radius.control, border: 'none', background: color.black, color: '#FFFFFF', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
            Invite user
          </button>
        )} />

      {inviting && (
        <Card>
          <form onSubmit={submitInvite} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Invite a new user</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="inv-name" style={label}>Full name</label>
                <input id="inv-name" required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" style={input} />
                {fieldErrors.fullName && <span style={{ fontSize: text.small, color: '#A8352F' }}>{fieldErrors.fullName}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="inv-email" style={label}>Work email</label>
                <input id="inv-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@theconts.com" style={input} />
                {fieldErrors.email && <span style={{ fontSize: text.small, color: '#A8352F' }}>{fieldErrors.email}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="inv-role" style={label}>Role</label>
                <select id="inv-role" value={role} onChange={e => setRole(e.target.value as UserRole)} style={{ ...input, textTransform: 'capitalize' }}>
                  {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{roleLabel(r)}</option>)}
                </select>
                {fieldErrors.role && <span style={{ fontSize: text.small, color: '#A8352F' }}>{fieldErrors.role}</span>}
              </div>
            </div>
            <div style={{ fontSize: text.small, color: color.textMuted }}>
              They'll be emailed a temporary password and asked to set their own on first sign-in.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={busy}
                style={{ height: 38, padding: '0 16px', borderRadius: radius.control, border: 'none', background: color.black, color: '#FFFFFF', fontSize: 13.5, fontWeight: 500, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, font: 'inherit' }}>
                {busy ? 'Sending…' : 'Send invitation'}
              </button>
              <button type="button" onClick={closeForm} disabled={busy}
                style={{ height: 38, padding: '0 16px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: '#FFFFFF', color: color.ink, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Name</div><div>Email</div><div>Role</div><div>Status</div><div>Last sign-in</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={7} cols={5} /> : rows.map(u => {
              const s = status(u);
              return (
                <div key={u.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                      {u.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.fullName}</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                  <span style={{ fontSize: 13, textTransform: 'capitalize' }}>{u.role.replace(/_/g, ' ')}</span>
                  <div><Badge tone={s.tone} label={s.label} /></div>
                  <span style={{ fontSize: 12.5, color: color.textMuted }}>{u.lastLoginAt ?? 'Never'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
