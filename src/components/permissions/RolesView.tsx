import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import { areaKeysOf, countGrants, resolveRoleLevels } from '../../lib/roleGrid';
import type { AccessChart, Department, Position } from '../../lib/types';
import { SIDE_OPTIONS, TAG, defaultRoleName, headCountWithoutPosition, isFieldKind, visibleCategoriesOf, type RoleTarget } from './shared';

export interface RolesViewProps {
  chart: AccessChart;
  onOpen: (target: RoleTarget) => void;
}

interface RoleRowProps {
  name: string;
  isLocked: boolean;
  people: number;
  summary: string;
  onOpen: () => void;
}

const ROW = 'grid w-full items-center gap-3 text-left bg-card border-0 [border-bottom:1px_solid_var(--color-line-soft)] [font-family:inherit] min-h-12 py-2.5 pr-5 pl-9 grid-cols-[minmax(0,1.3fr)_100px_minmax(0,1.6fr)_20px] max-md:grid-cols-[minmax(0,1fr)_20px] max-md:gap-y-0.5 max-md:px-4 max-md:pl-6';

function summaryFor(chart: AccessChart, department: Department, position: Position | null): string {
  const categories = visibleCategoriesOf(chart.categories, department);
  const areaKeys = areaKeysOf(categories);
  const levels = resolveRoleLevels(categories, chart.rules.department[department.id] ?? {}, position ? chart.rules.position[position.id] ?? {} : undefined);
  const { granted, full, available } = countGrants(levels, areaKeys);
  if (granted === 0) return 'No access yet';
  return `${granted} of ${available} areas${full > 0 ? ` · ${full} Full` : ''}`;
}

function RoleRow({ name, isLocked, people, summary, onOpen }: RoleRowProps) {
  return (
    <button type="button" onClick={onOpen} disabled={isLocked}
      className={cx(ROW, isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-muted')}>
      <span className="flex items-center gap-2 flex-wrap min-w-0 text-copy font-medium">
        {name}
        {isLocked && <span className={TAG} style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' }}>Locked</span>}
      </span>
      <span className="text-meta text-muted-ink max-md:col-start-1 max-md:row-start-2">{plural(people, 'person', 'people')}</span>
      <span className="text-meta text-muted-ink max-md:col-start-1 max-md:row-start-3">{summary}</span>
      {!isLocked && <span className="text-muted-ink justify-self-end max-md:col-start-2 max-md:row-start-1 max-md:row-span-3"><Icon name="ChevronRight" size="sm" /></span>}
    </button>
  );
}

function DepartmentRoles({ chart, department, onOpen }: { chart: AccessChart; department: Department; onOpen: RolesViewProps['onOpen'] }) {
  const isManagement = department.kind === 'management';
  return (
    <div>
      <div className="flex items-baseline gap-2 py-2.5 px-5 max-md:px-4 bg-card [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="text-copy font-semibold">{department.name}</span>
        <span className="text-caption text-muted-ink">{plural(isManagement ? 1 : department.positions.length + 1, 'role')}</span>
      </div>
      {isManagement ? (
        <RoleRow name="Management" isLocked people={department.headCount} summary="Full on everything. Cannot be changed." onOpen={() => undefined} />
      ) : (
        <>
          <RoleRow name={defaultRoleName(department)} isLocked={false} people={headCountWithoutPosition(department)} summary={summaryFor(chart, department, null)}
            onOpen={() => onOpen({ departmentId: department.id, positionId: null })} />
          {department.positions.map(position => (
            <RoleRow key={position.id} name={position.name} isLocked={false} people={position.headCount} summary={summaryFor(chart, department, position)}
              onOpen={() => onOpen({ departmentId: department.id, positionId: position.id })} />
          ))}
        </>
      )}
    </div>
  );
}

export default function RolesView({ chart, onOpen }: RolesViewProps) {
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
          <div className="py-2.5 px-5 max-md:px-4 bg-muted [border-top:1px_solid_var(--color-line)] [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold uppercase tracking-wide text-ink">
            {option.value === 'both' ? 'Both companies' : option.label}
          </div>
          {departments.map(department => <DepartmentRoles key={department.id} chart={chart} department={department} onOpen={onOpen} />)}
        </div>
      ))}
    </>
  );
}
