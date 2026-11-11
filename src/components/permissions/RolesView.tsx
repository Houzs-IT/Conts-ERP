import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import { areaKeysOf, countGrants, resolveRoleLevels } from '../../lib/roleGrid';
import type { AccessChart, Department, Position } from '../../lib/types';
import { CompanyToggle } from './CompanyToggle';
import { SIDE_OPTIONS, TAG, defaultRoleName, headCountWithoutPosition, isFieldKind, isSameRole, useToggleSet, visibleCategoriesOf, type RoleTarget } from './shared';

export interface RolesViewProps {
  chart: AccessChart;
  selectedRole: RoleTarget | null;
  onOpen: (target: RoleTarget) => void;
}

interface RoleRowProps {
  name: string;
  isLocked: boolean;
  isSelected: boolean;
  people: number;
  summary: string;
  onOpen: () => void;
}

interface DepartmentRolesProps {
  chart: AccessChart;
  department: Department;
  selectedRole: RoleTarget | null;
  onOpen: (target: RoleTarget) => void;
}

const ROW = 'flex w-full items-center gap-3 text-left border-0 [border-bottom:1px_solid_var(--color-line-soft)] [font-family:inherit] min-h-14 py-2.5 pr-4 pl-8';

function summaryFor(chart: AccessChart, department: Department, position: Position | null): string {
  const categories = visibleCategoriesOf(chart.categories, department);
  const areaKeys = areaKeysOf(categories);
  const levels = resolveRoleLevels(categories, chart.rules.department[department.id] ?? {}, position ? chart.rules.position[position.id] ?? {} : undefined);
  const { granted, full, available } = countGrants(levels, areaKeys);
  if (granted === 0) return 'No access yet';
  return `${granted} of ${available} areas${full > 0 ? ` · ${full} Full` : ''}`;
}

function RoleRow({ name, isLocked, isSelected, people, summary, onOpen }: RoleRowProps) {
  return (
    <button type="button" onClick={onOpen} disabled={isLocked} aria-current={isSelected || undefined}
      className={cx(ROW, isSelected ? 'bg-info-bg shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card',
        isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-muted')}>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-2 flex-wrap text-copy font-medium">
          {name}
          {isLocked && <span className={TAG} style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' }}>Locked</span>}
        </span>
        <span className="text-meta text-muted-ink">{plural(people, 'person', 'people')} · {summary}</span>
      </span>
      {!isLocked && <span className="flex-none text-muted-ink lg:hidden"><Icon name="ChevronRight" size="sm" /></span>}
    </button>
  );
}

function DepartmentRoles({ chart, department, selectedRole, onOpen }: DepartmentRolesProps) {
  const isManagement = department.kind === 'management';
  const rowFor = (position: Position | null) => {
    const target = { departmentId: department.id, positionId: position?.id ?? null };
    return (
      <RoleRow key={position?.id ?? 'staff'} name={position?.name ?? defaultRoleName(department)} isLocked={false}
        isSelected={isSameRole(selectedRole, target)}
        people={position ? position.headCount : headCountWithoutPosition(department)}
        summary={summaryFor(chart, department, position)} onOpen={() => onOpen(target)} />
    );
  };
  return (
    <div>
      <div className="flex items-baseline gap-2 py-2.5 px-4 bg-card [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="text-copy font-semibold">{department.name}</span>
        <span className="text-caption text-muted-ink">{plural(isManagement ? 1 : department.positions.length + 1, 'role')}</span>
      </div>
      {isManagement
        ? <RoleRow name="Management" isLocked isSelected={false} people={department.headCount} summary="Full on everything. Cannot be changed." onOpen={() => undefined} />
        : [rowFor(null), ...department.positions.map(rowFor)]}
    </div>
  );
}

export default function RolesView({ chart, selectedRole, onOpen }: RolesViewProps) {
  const collapsedCompanies = useToggleSet();
  const companies = SIDE_OPTIONS
    .map(option => ({ option, departments: chart.departments.filter(department => !isFieldKind(department.kind) && department.side === option.value) }))
    .filter(company => company.departments.length > 0);

  if (companies.length === 0) {
    return <div className="p-5 text-copy text-muted-ink">No departments yet. Add one under Setup.</div>;
  }
  return (
    <>
      {companies.map(({ option, departments }) => (
        <div key={option.value}>
          <CompanyToggle label={option.value === 'both' ? 'Both companies' : option.label} note={plural(departments.length, 'department')}
            isOpen={!collapsedCompanies.has(option.value)} onToggle={() => collapsedCompanies.toggle(option.value)}
            className="py-2 px-3 bg-muted hover:bg-page [border-bottom:1px_solid_var(--color-line)] text-ink" />
          {!collapsedCompanies.has(option.value) && departments.map(department => (
            <DepartmentRoles key={department.id} chart={chart} department={department} selectedRole={selectedRole} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </>
  );
}
