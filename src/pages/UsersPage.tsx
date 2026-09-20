import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { UserRole } from '../lib/types';

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

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/users', FALLBACK);
  const rows = data?.data ?? [];
  const invited = rows.filter(r => status(r).label === 'Invited').length;

  return (
    <>
      <PageHeader title="Users and roles" sub={`${rows.length} accounts · ${invited} invited and not yet signed in`} />

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
