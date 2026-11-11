import { useState } from 'react';
import { Field } from '../Field';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import type { AccessChart, Department, PermissionPerson } from '../../lib/types';
import { GroupToggle } from './GroupToggle';
import {
  COMPANY_HEADING, COMPANY_LABEL, DEPARTMENT_HEADING, DEPARTMENT_LABEL, LIST_ROW, NO_POSITION_LABEL, SELECTED_ROW, TAG, deskCompaniesOf, useToggleSet,
  type ToggleSet,
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
          {person.fullName}
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
  const collapsedCompanies = useToggleSet();
  const collapsedDepartments = useToggleSet();
  const searchText = search.trim().toLowerCase();
  const isSearching = searchText !== '';
  const isOpen = (collapsed: ToggleSet, key: string) => isSearching || !collapsed.has(key);
  const peopleIn = (department: Department) => chart.people.filter(person =>
    person.departmentId === department.id && (!isSearching || person.fullName.toLowerCase().includes(searchText)));
  const companies = deskCompaniesOf(chart.departments)
    .map(company => ({ ...company, departments: company.departments.filter(department => peopleIn(department).length > 0) }))
    .filter(company => company.departments.length > 0);

  return (
    <>
      <div className="p-3 [border-bottom:1px_solid_var(--color-line)]">
        <Field aria-label="Search people" type="search" placeholder="Search people" value={search} onChange={event => setSearch(event.target.value)} />
      </div>
      {companies.length === 0 && (
        <p className="m-0 p-5 text-copy text-muted-ink">{isSearching ? `Nobody matches “${search.trim()}”.` : 'Nobody is in a department yet.'}</p>
      )}
      {companies.map(({ side, label, departments }) => (
        <div key={side}>
          <GroupToggle label={label} note={plural(departments.length, 'department')}
            isOpen={isOpen(collapsedCompanies, side)} onToggle={() => collapsedCompanies.toggle(side)}
            className={COMPANY_HEADING} labelClassName={COMPANY_LABEL} />
          {isOpen(collapsedCompanies, side) && departments.map(department => {
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
        </div>
      ))}
    </>
  );
}
