import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { areaKeysOf, countChanged, countGrants, resolveRoleLevels, rulesToWrite } from '../../lib/roleGrid';
import type { AccessChart, Department, Position } from '../../lib/types';
import { BackLink } from './MasterDetail';
import RoleGrid, { groupByCompany } from './RoleGrid';
import { NO_POSITION_LABEL, SAVE_BAR, closedCompanyLabel, headCountWithoutPosition, sideLabel, visibleCategoriesOf, type RoleTarget } from './shared';

export interface RolePageProps {
  chart: AccessChart;
  target: RoleTarget;
  onBack: () => void;
  onSaved: () => void;
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
}

interface RoleEditorProps {
  chart: AccessChart;
  department: Department;
  position: Position | null;
  onBack: () => void;
  onSaved: () => void;
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
}

function Unavailable({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-3 items-start p-5 max-md:p-4">
      <BackLink label="Roles" onBack={onBack} />
      <p className="m-0 text-copy text-muted-ink">{message}</p>
    </div>
  );
}

export default function RolePage({ chart, target, onBack, onSaved, onDirtyChange }: RolePageProps) {
  const department = chart.departments.find(candidate => candidate.id === target.departmentId);
  const position = department?.positions.find(candidate => candidate.id === target.positionId) ?? null;

  if (!department || (target.positionId && !position)) {
    return <Unavailable message="This role no longer exists. Go back and pick another." onBack={onBack} />;
  }
  if (department.kind === 'management') {
    return <Unavailable message="Management always has full access to everything and cannot be changed." onBack={onBack} />;
  }
  return <RoleEditor chart={chart} department={department} position={position} onBack={onBack} onSaved={onSaved} onDirtyChange={onDirtyChange} />;
}

function RoleEditor({ chart, department, position, onBack, onSaved, onDirtyChange }: RoleEditorProps) {
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const categories = useMemo(() => visibleCategoriesOf(chart.categories, department), [chart.categories, department]);
  const areaKeys = useMemo(() => areaKeysOf(categories), [categories]);
  const companies = useMemo(() => groupByCompany(categories), [categories]);

  const departmentRules = chart.rules.department[department.id] ?? {};
  const positionRules = position ? chart.rules.position[position.id] ?? {} : undefined;
  const storedRules = positionRules ?? departmentRules;
  const savedLevels = useMemo(
    () => resolveRoleLevels(categories, departmentRules, positionRules),
    [categories, departmentRules, positionRules],
  );
  const [levels, setLevels] = useState(savedLevels);

  const changedCount = countChanged(savedLevels, levels, areaKeys);
  const hasUnsavedChanges = changedCount > 0;
  useEffect(() => { onDirtyChange(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);

  const { granted, full, available } = countGrants(levels, areaKeys);
  const isLocked = !chart.canEdit || isSaving;
  const roleName = position?.name ?? NO_POSITION_LABEL;
  const people = position ? position.headCount : headCountWithoutPosition(department);
  const closedNote = department.side === 'both'
    ? null
    : `${department.name} works on ${sideLabel(department.side)} only. ${closedCompanyLabel(department.side)} areas are closed for it, so they are not shown.`;

  async function save() {
    const scope = position ? 'position' : 'department';
    const scopeId = position ? position.id : department.id;
    const changes = rulesToWrite(categories, storedRules, levels).map(({ key, level }) => ({ scope, scopeId, key, level }));
    setIsSaving(true);
    try {
      await api.put('/users/access', { changes });
      toast({ tone: 'success', title: `${department.name} / ${roleName} saved.`, body: 'People in this role see it the next time they open or refresh the system.' });
      onSaved();
    } catch (error) {
      toast({ tone: 'critical', title: 'The role was not saved.', body: errorMessage(error, 'Try again in a moment.') });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3.5 max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
        <BackLink label="Roles" onBack={onBack} />
        <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{department.name} / {roleName}</h2>
        <span className="text-meta text-muted-ink">
          {position ? `Position in ${department.name}` : `Everyone in ${department.name} with no position`}
          {' · '}{sideLabel(department.side)} · {plural(people, 'person', 'people')}
        </span>
        <span className="text-copy"><b>{granted}</b> of {available} areas{full > 0 && <> · <b>{full}</b> Full</>}</span>
        {closedNote && <p className="m-0 mt-1 py-2 px-2.5 rounded-control bg-muted text-meta text-muted-ink">{closedNote}</p>}
        {!chart.canEdit && <p className="m-0 text-meta text-muted-ink">Only management can change this.</p>}
      </div>

      <RoleGrid companies={companies} levels={levels} savedLevels={savedLevels} isLocked={isLocked} onChange={setLevels} />

      {chart.canEdit && (
        <div className={SAVE_BAR}>
          <span className="text-meta text-muted-ink">
            {changedCount === 0 ? 'No unsaved changes.' : `${changedCount} ${changedCount === 1 ? 'area' : 'areas'} changed.`}
          </span>
          <span className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:min-h-11">
            <Button onClick={() => setLevels(savedLevels)} disabled={changedCount === 0 || isSaving} disabledReason="Nothing has changed yet.">Discard</Button>
            <Button variant="primary" onClick={save} loading={isSaving} disabled={changedCount === 0} disabledReason="Nothing has changed yet.">Save role</Button>
          </span>
        </div>
      )}
    </div>
  );
}
