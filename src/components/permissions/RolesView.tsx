import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import { areaKeysOf, countGrants, resolveRoleLevels } from '../../lib/roleGrid';
import type { AccessChart, Department, Position } from '../../lib/types';
import { GroupToggle } from './GroupToggle';
import {
  COMPANY_HEADING, COMPANY_LABEL, DEPARTMENT_HEADING, DEPARTMENT_LABEL, LIST_ROW, NO_POSITION_LABEL, SELECTED_ROW, TAG, deskCompaniesOf, hasPeopleWithoutPosition, headCountWithoutPosition, isSameRole, useToggleSet, visibleCategoriesOf, type RoleTarget,
} from './shared';

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
  isOpen: boolean;
  onToggle: () => void;
  onOpen: (target: RoleTarget) => void;
}

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
      className={cx(LIST_ROW, isSelected ? SELECTED_ROW : 'bg-card',
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

function NoPositionsYet() {
  return <p className={cx(LIST_ROW, 'm-0 bg-card text-meta text-muted-ink')}>No positions yet. Add one under Setup.</p>;
}

function DepartmentRoles({ chart, department, selectedRole, isOpen, onToggle, onOpen }: DepartmentRolesProps) {
  const isManagement = department.kind === 'management';
  const rowFor = (position: Position | null) => {
    const target = { departmentId: department.id, positionId: position?.id ?? null };
    return (
      <RoleRow key={position?.id ?? 'no-position'} name={position?.name ?? NO_POSITION_LABEL} isLocked={false}
        isSelected={isSameRole(selectedRole, target)}
        people={position ? position.headCount : headCountWithoutPosition(department)}
        summary={summaryFor(chart, department, position)} onOpen={() => onOpen(target)} />
    );
  };
  const positionsShown: (Position | null)[] = hasPeopleWithoutPosition(department) ? [null, ...department.positions] : department.positions;
  return (
    <div>
      <GroupToggle label={department.name} note={plural(isManagement ? 1 : positionsShown.length, 'role')}
        isOpen={isOpen} onToggle={onToggle} className={DEPARTMENT_HEADING} labelClassName={DEPARTMENT_LABEL} />
      {isOpen && (isManagement
        ? <RoleRow name="Management" isLocked isSelected={false} people={department.headCount} summary="Full on everything. Cannot be changed." onOpen={() => undefined} />
        : positionsShown.length > 0 ? positionsShown.map(rowFor) : <NoPositionsYet />)}
    </div>
  );
}

export default function RolesView({ chart, selectedRole, onOpen }: RolesViewProps) {
  const collapsedCompanies = useToggleSet();
  const collapsedDepartments = useToggleSet();
  const companies = deskCompaniesOf(chart.departments);

  if (companies.length === 0) {
    return <div className="p-5 text-copy text-muted-ink">No departments yet. Add one under Setup.</div>;
  }
  return (
    <>
      {companies.map(({ side, label, departments }) => (
        <div key={side}>
          <GroupToggle label={label} note={plural(departments.length, 'department')}
            isOpen={!collapsedCompanies.has(side)} onToggle={() => collapsedCompanies.toggle(side)}
            className={COMPANY_HEADING} labelClassName={COMPANY_LABEL} />
          {!collapsedCompanies.has(side) && departments.map(department => (
            <DepartmentRoles key={department.id} chart={chart} department={department} selectedRole={selectedRole}
              isOpen={!collapsedDepartments.has(department.id)} onToggle={() => collapsedDepartments.toggle(department.id)} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </>
  );
}
