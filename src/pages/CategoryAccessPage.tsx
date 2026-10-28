import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import CategoryAccessEditor, { subKey, type CategoryChoice, type CategoryTreeGroup } from '../components/CategoryAccessEditor';
import { useApi } from '../lib/useApi';
import { plural } from '../lib/format';

/**
 * Category access (Dream Crafter > System): pick a person, then tick which product categories and sub-categories they
 * may see on the renovation beta project screens. A person with nothing set sees everything. The people are the Users
 * and roles list; the limits come from GET /users/category-access (management only; the server refuses anyone else).
 */
interface UserRow { id: string; fullName: string; role: string; isActive: boolean; department?: string | null; position?: string | null }
interface LimitedPerson extends CategoryChoice { userId: string }
interface CategoryAccessList { catalog: CategoryTreeGroup[]; limited: LimitedPerson[] }

interface Row {
  id: string; fullName: string; department: string | null; position: string | null; isActive: boolean;
  /** Null: no limit, the person sees everything. */
  limit: LimitedPerson | null;
}

/** "Works, Soft furnishing (2 of 6), Uncategorised": what a limited person is limited to. */
function limitedTo(catalog: CategoryTreeGroup[], limit: LimitedPerson): string {
  const parts = catalog.flatMap(g => {
    if (limit.groups.includes(g.code)) return [g.label];
    const picked = g.subs.filter(s => limit.subs.includes(subKey(g.code, s.code))).length;
    return picked > 0 ? [`${g.label} (${picked} of ${g.subs.length})`] : [];
  });
  if (limit.other) parts.push('Uncategorised');
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}
const limitText = (catalog: CategoryTreeGroup[], limit: LimitedPerson | null): string =>
  limit ? `Limited to ${limitedTo(catalog, limit)}` : 'Sees everything';

const jobOf = (r: Pick<Row, 'department' | 'position'>): string => [r.position, r.department].filter(Boolean).join(' · ');

export default function CategoryAccessPage() {
  const people = useApi<{ data: UserRow[] }>('/users');
  const access = useApi<CategoryAccessList>('/users/category-access');
  const [picked, setPicked] = useState<string | null>(null);

  const catalog = useMemo(() => access.data?.catalog ?? [], [access.data]);
  const rows = useMemo<Row[] | null>(() => {
    if (!people.data || !access.data) return null;
    const limits = new Map(access.data.limited.map(l => [l.userId, l]));
    // Owner accounts only use the owner portal, so there is nothing to limit for them.
    return people.data.data.filter(u => u.role !== 'owner').map(u => ({
      id: u.id, fullName: u.fullName, department: u.department ?? null, position: u.position ?? null, isActive: u.isActive, limit: limits.get(u.id) ?? null,
    }));
  }, [people.data, access.data]);
  const limitedCount = rows?.filter(r => r.limit).length ?? 0;
  const person = rows?.find(r => r.id === picked) ?? null;

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'name', label: 'Name', value: r => r.fullName, hideable: false, width: 220,
      render: r => (
        <span className="flex flex-col gap-px min-w-0">
          <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={r.fullName}>{r.fullName}</span>
          {!r.isActive && <span className="text-caption text-muted-ink">Account switched off</span>}
        </span>
      ) },
    { key: 'department', label: 'Department', value: r => r.department, width: 160 },
    { key: 'position', label: 'Position', value: r => r.position, width: 160 },
    { key: 'categories', label: 'Product categories', width: 320, value: r => limitText(catalog, r.limit),
      render: r => r.limit
        ? <span className="flex items-center gap-2 min-w-0"><StatusBadge tone="warning" label="Limited" size="sm" /><span className="text-copy text-ink truncate" title={limitText(catalog, r.limit)}>{limitedTo(catalog, r.limit)}</span></span>
        : <span className="text-copy text-muted-ink">Sees everything</span> },
  ], [catalog]);

  const reload = () => { people.reload(); access.reload(); };
  const error = people.error ?? access.error;

  return (
    <>
      <PageHeader
        title="Category access"
        sub={rows ? `${plural(rows.length, 'person', 'people')} · ${limitedCount} limited to some categories` : 'Loading people…'}
      />
      <DataTable<Row>
        id="category-access" columns={columns} rows={rows} rowKey={r => r.id}
        loading={people.loading || access.loading} error={error} onRetry={reload} onRowClick={r => setPicked(r.id)}
        pageSize={0} noun={['person', 'people']} exportName="category-access" noViews
        header={
          <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink">
            Pick a person to choose which product categories they see on the renovation project screens. Someone with nothing set up sees everything.
          </div>
        }
        empty={{ title: 'No people yet.', icon: 'Users' }}
      />
      <Drawer open={!!person} onClose={() => setPicked(null)} width={520} labelledBy="category-access-title">
        {person && (
          <CategoryAccessEditor key={person.id} person={{ id: person.id, fullName: person.fullName, job: jobOf(person) }}
            catalog={catalog} onClose={() => setPicked(null)} onSaved={access.reload} />
        )}
      </Drawer>
    </>
  );
}
