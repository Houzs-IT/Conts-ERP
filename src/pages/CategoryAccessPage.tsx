import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { Segmented } from '../components/Metric';
import { StatusBadge } from '../components/StatusBadge';
import CategoryAccessEditor, { describeLimit, type AccessSubject, type CategoryChoice, type CategoryTreeGroup } from '../components/CategoryAccessEditor';
import { isFieldKind, sideLabel, useDepartments } from '../components/permissions/shared';
import { useApi } from '../lib/useApi';
import { plural } from '../lib/format';

/**
 * Category access (Dream Crafter > System): choose which product categories and sub-categories show on the renovation
 * beta project screens. Set it for a whole department first, then for a person who needs something different: a person's
 * own list replaces their department's. Nothing set means everything is shown. The limits come from
 * GET /departments/category-access and /users/category-access (management only; the server refuses anyone else).
 */
interface UserRow { id: string; fullName: string; role: string; isActive: boolean; department?: string | null; position?: string | null; departmentId?: string | null }
interface LimitedPerson extends CategoryChoice { userId: string }
interface LimitedDepartment extends CategoryChoice { departmentId: string }
interface PersonAccessList { catalog: CategoryTreeGroup[]; limited: LimitedPerson[] }
interface DepartmentAccessList { catalog: CategoryTreeGroup[]; limited: LimitedDepartment[] }

type View = 'departments' | 'people';
const VIEWS: { key: View; label: string }[] = [{ key: 'departments', label: 'Departments' }, { key: 'people', label: 'People' }];

interface DepartmentRow { id: string; name: string; side: string; headCount: number; limit: LimitedDepartment | null }
interface PersonRow {
  id: string; fullName: string; department: string | null; position: string | null; isActive: boolean;
  /** Their own list. Null: they follow their department. */
  limit: LimitedPerson | null;
  /** What their department limits them to when they have no list of their own. */
  inherited: { name: string; limit: LimitedDepartment } | null;
}

const jobOf = (r: Pick<PersonRow, 'department' | 'position'>): string => [r.position, r.department].filter(Boolean).join(' · ');

/** Badge and text for a limit: Limited to ..., or sees everything. */
function LimitCell({ catalog, limit, from }: { catalog: CategoryTreeGroup[]; limit: CategoryChoice | null; from?: string }) {
  if (!limit) return <span className="text-copy text-muted-ink">Sees everything</span>;
  const text = describeLimit(catalog, limit);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <StatusBadge tone="warning" label={from ? `From ${from}` : 'Limited'} size="sm" />
      <span className="text-copy text-ink truncate" title={text}>{text}</span>
    </span>
  );
}

export default function CategoryAccessPage() {
  const [view, setView] = useState<View>('departments');
  const [picked, setPicked] = useState<AccessSubject | null>(null);

  const departments = useDepartments();
  const people = useApi<{ data: UserRow[] }>('/users');
  const personAccess = useApi<PersonAccessList>('/users/category-access');
  const departmentAccess = useApi<DepartmentAccessList>('/departments/category-access');

  const catalog = useMemo(() => departmentAccess.data?.catalog ?? personAccess.data?.catalog ?? [], [departmentAccess.data, personAccess.data]);

  const deptLimits = useMemo(() => new Map((departmentAccess.data?.limited ?? []).map(l => [l.departmentId, l])), [departmentAccess.data]);

  const departmentRows = useMemo<DepartmentRow[] | null>(() => {
    if (!departments.data || !departmentAccess.data) return null;
    // The cleaning and maintenance departments use the field app only, so there is nothing to limit for them.
    return departments.data.departments.filter(d => !isFieldKind(d.kind)).map(d => ({
      id: d.id, name: d.name, side: sideLabel(d.side), headCount: d.headCount, limit: deptLimits.get(d.id) ?? null,
    }));
  }, [departments.data, departmentAccess.data, deptLimits]);

  const personRows = useMemo<PersonRow[] | null>(() => {
    if (!people.data || !personAccess.data || !departments.data) return null;
    const own = new Map(personAccess.data.limited.map(l => [l.userId, l]));
    const names = new Map(departments.data.departments.map(d => [d.id, d.name]));
    // Owner accounts only use the owner portal, so there is nothing to limit for them.
    return people.data.data.filter(u => u.role !== 'owner').map(u => {
      const fromDept = u.departmentId ? deptLimits.get(u.departmentId) ?? null : null;
      return {
        id: u.id, fullName: u.fullName, department: u.department ?? null, position: u.position ?? null, isActive: u.isActive,
        limit: own.get(u.id) ?? null,
        inherited: fromDept && u.departmentId ? { name: names.get(u.departmentId) ?? 'their department', limit: fromDept } : null,
      };
    });
  }, [people.data, personAccess.data, departments.data, deptLimits]);

  const departmentColumns = useMemo<Column<DepartmentRow>[]>(() => [
    { key: 'name', label: 'Department', value: r => r.name, hideable: false, width: 220 },
    { key: 'side', label: 'Side', value: r => r.side, width: 140 },
    { key: 'people', label: 'People', value: r => r.headCount, width: 100 },
    { key: 'categories', label: 'Product categories', width: 360, value: r => (r.limit ? describeLimit(catalog, r.limit) : 'Sees everything'),
      render: r => <LimitCell catalog={catalog} limit={r.limit} /> },
  ], [catalog]);

  const personColumns = useMemo<Column<PersonRow>[]>(() => [
    { key: 'name', label: 'Name', value: r => r.fullName, hideable: false, width: 220,
      render: r => (
        <span className="flex flex-col gap-px min-w-0">
          <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={r.fullName}>{r.fullName}</span>
          {!r.isActive && <span className="text-caption text-muted-ink">Account switched off</span>}
        </span>
      ) },
    { key: 'department', label: 'Department', value: r => r.department, width: 160 },
    { key: 'position', label: 'Position', value: r => r.position, width: 160 },
    { key: 'categories', label: 'Product categories', width: 360,
      value: r => (r.limit ? describeLimit(catalog, r.limit) : r.inherited ? describeLimit(catalog, r.inherited.limit) : 'Sees everything'),
      render: r => r.limit
        ? <LimitCell catalog={catalog} limit={r.limit} />
        : <LimitCell catalog={catalog} limit={r.inherited?.limit ?? null} from={r.inherited?.name} /> },
  ], [catalog]);

  const isDepartments = view === 'departments';
  const reload = () => { departments.reload(); people.reload(); personAccess.reload(); departmentAccess.reload(); };
  const limitedDepartments = departmentRows?.filter(r => r.limit).length ?? 0;
  const limitedPeople = personRows?.filter(r => r.limit).length ?? 0;

  return (
    <>
      <PageHeader
        title="Category access"
        sub={isDepartments
          ? (departmentRows ? `${plural(departmentRows.length, 'department')} · ${limitedDepartments} limited to some categories` : 'Loading departments…')
          : (personRows ? `${plural(personRows.length, 'person', 'people')} · ${limitedPeople} with their own list` : 'Loading people…')}
      />
      <div className="mb-3">
        <Segmented label="Set category access for" value={view} onChange={setView} options={VIEWS} />
      </div>
      {isDepartments ? (
        <DataTable<DepartmentRow>
          id="category-access-departments" columns={departmentColumns} rows={departmentRows} rowKey={r => r.id}
          loading={departments.loading || departmentAccess.loading} error={departments.error ?? departmentAccess.error} onRetry={reload}
          onRowClick={r => setPicked({ kind: 'department', id: r.id, name: r.name, job: `${r.side} · ${plural(r.headCount, 'person', 'people')}` })}
          pageSize={0} noun={['department', 'departments']} exportName="category-access-departments" noViews
          header={
            <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink">
              Pick a department to choose which product categories everyone in it sees on the renovation project screens. A department with nothing set sees everything.
              Use People when one person needs something different.
            </div>
          }
          empty={{ title: 'No departments yet.', icon: 'Users' }}
        />
      ) : (
        <DataTable<PersonRow>
          id="category-access" columns={personColumns} rows={personRows} rowKey={r => r.id}
          loading={people.loading || personAccess.loading || departments.loading} error={people.error ?? personAccess.error ?? departments.error} onRetry={reload}
          onRowClick={r => setPicked({ kind: 'user', id: r.id, name: r.fullName, job: jobOf(r) })}
          pageSize={0} noun={['person', 'people']} exportName="category-access" noViews
          header={
            <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink">
              Someone follows their department unless you give them a list of their own here. A person's own list replaces their department's.
            </div>
          }
          empty={{ title: 'No people yet.', icon: 'Users' }}
        />
      )}
      <Drawer open={!!picked} onClose={() => setPicked(null)} width={520} labelledBy="category-access-title">
        {picked && (
          <CategoryAccessEditor key={`${picked.kind}:${picked.id}`} subject={picked} catalog={catalog}
            onClose={() => setPicked(null)} onSaved={reload} />
        )}
      </Drawer>
    </>
  );
}
