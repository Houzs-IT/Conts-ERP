import { useState } from 'react';
import { Field } from '../Field';
import Icon from '../Icon';
import { Segmented, type SegmentOption } from '../Metric';
import { cx } from '../../lib/design-tokens';
import { plural, personName } from '../../lib/format';
import type { AccessChart, Department, PermissionPerson, UserSide } from '../../lib/types';
import { GroupToggle } from './GroupToggle';
import {
  DEPARTMENT_HEADING, DEPARTMENT_LABEL, LIST_ROW, NO_POSITION_LABEL, SELECTED_ROW, SIDE_OPTIONS, TAG, isFieldKind, useToggleSet, type ToggleSet,
} from './shared';

export interface PeopleViewProps {
  chart: AccessChart;
  selectedPersonId: string | null;
  onOpen: (personId: string) => void;
}

interface PersonRowProps {
  person: PermissionPerson;
  roleName: string;
  isSelected: boolean;
  onOpen: () => void;
}

type SideFilter = 'all' | UserSide;

const sideFilterOptions = (people: PermissionPerson[]): SegmentOption<SideFilter>[] => [
  { key: 'all', label: 'All', count: people.length },
  ...SIDE_OPTIONS.map(option => ({ key: option.value, label: option.label, count: people.filter(person => person.side === option.value).length })),
];

const CUSTOM_TAG_STYLE = { background: 'var(--color-info-bg)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' };
const OFF_TAG_STYLE = { color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' };

function roleNameOf(person: PermissionPerson, department: Department): string {
  if (department.kind === 'management') return 'Management';
  return department.positions.find(position => position.id === person.positionId)?.name ?? NO_POSITION_LABEL;
}

function PersonRow({ person, roleName, isSelected, onOpen }: PersonRowProps) {
  return (
    <button type="button" onClick={onOpen} aria-current={isSelected || undefined}
      className={cx(LIST_ROW, isSelected ? SELECTED_ROW : 'bg-card', 'cursor-pointer hover:bg-muted')}>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-2 flex-wrap text-copy font-medium">
          {personName(person.fullName)}
          {person.customCount > 0 && <span className={TAG} style={CUSTOM_TAG_STYLE}>{person.customCount} custom</span>}
          {!person.isActive && <span className={TAG} style={OFF_TAG_STYLE}>Switched off</span>}
        </span>
        <span className="text-meta text-muted-ink">{roleName}</span>
      </span>
      <span className="flex-none text-muted-ink lg:hidden"><Icon name="ChevronRight" size="sm" /></span>
    </button>
  );
}

export default function PeopleView({ chart, selectedPersonId, onOpen }: PeopleViewProps) {
  const [search, setSearch] = useState('');
  const [sideFilter, setSideFilter] = useState<SideFilter>('all');
  const collapsedDepartments = useToggleSet();
  const searchText = search.trim().toLowerCase();
  const isSearching = searchText !== '';
  const isOpen = (collapsed: ToggleSet, key: string) => isSearching || !collapsed.has(key);
  const deskDepartments = chart.departments.filter(department => !isFieldKind(department.kind));
  const deskPeople = chart.people.filter(person => deskDepartments.some(department => department.id === person.departmentId));
  const peopleIn = (department: Department) => deskPeople.filter(person =>
    person.departmentId === department.id
    && (sideFilter === 'all' || person.side === sideFilter)
    && (!isSearching || person.fullName.toLowerCase().includes(searchText)));
  const departments = deskDepartments.filter(department => peopleIn(department).length > 0);

  return (
    <>
      <div className="flex flex-col gap-2.5 p-3 [border-bottom:1px_solid_var(--color-line)]">
        <Field aria-label="Search people" type="search" placeholder="Search people" value={search} onChange={event => setSearch(event.target.value)} />
        <Segmented label="Show people who work on" value={sideFilter} onChange={setSideFilter} options={sideFilterOptions(deskPeople)} />
      </div>
      {departments.length === 0 && (
        <p className="m-0 p-5 text-copy text-muted-ink">
          {isSearching ? `Nobody matches “${search.trim()}”.` : deskPeople.length === 0 ? 'Nobody is in a department yet.' : 'Nobody works on this side.'}
        </p>
      )}
      {departments.map(department => {
        const people = peopleIn(department);
        return (
          <div key={department.id}>
            <GroupToggle label={department.name} note={plural(people.length, 'person', 'people')}
              isOpen={isOpen(collapsedDepartments, department.id)} onToggle={() => collapsedDepartments.toggle(department.id)}
              className={DEPARTMENT_HEADING} labelClassName={DEPARTMENT_LABEL} />
            {isOpen(collapsedDepartments, department.id) && people.map(person => (
              <PersonRow key={person.id} person={person} roleName={roleNameOf(person, department)}
                isSelected={person.id === selectedPersonId} onOpen={() => onOpen(person.id)} />
            ))}
          </div>
        );
      })}
    </>
  );
}
