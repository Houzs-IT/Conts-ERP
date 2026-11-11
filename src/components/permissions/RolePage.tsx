import { useMemo, useState } from 'react';
import { Button } from '../Button';
import { Card } from '../Card';
import Icon from '../Icon';
import { useConfirm } from '../ConfirmDialog';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { areaKeysOf, countChanged, countGrants, resolveRoleLevels, rulesToWrite } from '../../lib/roleGrid';
import type { AccessChart, Department, Position } from '../../lib/types';
import RoleGrid, { groupByCompany } from './RoleGrid';
import { closedCompanyLabel, defaultRoleName, headCountWithoutPosition, sideLabel, visibleCategoriesOf, type RoleTarget } from './shared';

export interface RolePageProps {
  chart: AccessChart;
  target: RoleTarget;
  onBack: () => void;
  onSaved: () => void;
}

interface RoleEditorProps {
  chart: AccessChart;
  department: Department;
  position: Position | null;
  onBack: () => void;
  onSaved: () => void;
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="tertiary" size="sm" icon={<Icon name="ChevronLeft" size="sm" />} onClick={onBack}>Roles</Button>
  );
}

function Unavailable({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-3 items-start">
      <BackLink onBack={onBack} />
      <p className="m-0 text-copy text-muted-ink">{message}</p>
    </div>
  );
}

export default function RolePage({ chart, target, onBack, onSaved }: RolePageProps) {
  const department = chart.departments.find(candidate => candidate.id === target.departmentId);
  const position = department?.positions.find(candidate => candidate.id === target.positionId) ?? null;

  if (!department || (target.positionId && !position)) {
    return <Unavailable message="This role no longer exists. Go back and pick another." onBack={onBack} />;
  }
  if (department.kind === 'management') {
    return <Unavailable message="Management always has full access to everything and cannot be changed." onBack={onBack} />;
  }
  return <RoleEditor key={`${department.id}:${position?.id ?? ''}`} chart={chart} department={department} position={position} onBack={onBack} onSaved={onSaved} />;
}

function RoleEditor({ chart, department, position, onBack, onSaved }: RoleEditorProps) {
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
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
  const { granted, full, available } = countGrants(levels, areaKeys);
  const isLocked = !chart.canEdit || isSaving;
  const roleName = position?.name ?? defaultRoleName(department);
  const people = position ? position.headCount : headCountWithoutPosition(department);
  const closedNote = department.side === 'both'
    ? null
    : `${department.name} works on ${sideLabel(department.side)} only. ${closedCompanyLabel(department.side)} areas are closed for it, so they are not shown.`;

  async function goBack() {
    if (changedCount > 0 && (await ask({ title: 'Discard the unsaved changes?', confirmLabel: 'Discard changes', danger: true })) === null) return;
    onBack();
  }

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
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <div className="-ml-2.5"><BackLink onBack={goBack} /></div>
        <div className="flex items-baseline gap-x-2.5 gap-y-0.5 flex-wrap">
          <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{department.name} / {roleName}</h2>
          <span className="text-meta text-muted-ink">
            {position ? `Position in ${department.name}` : `Everyone in ${department.name} with no position`}
            <span className="md:hidden"> · {sideLabel(department.side)} · {plural(people, 'person', 'people')}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-3.5 items-start md:grid-cols-[270px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-4 max-md:p-3">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-copy max-md:hidden">
            <dt className="text-muted-ink">Department</dt><dd className="m-0 text-right font-medium">{department.name}</dd>
            <dt className="text-muted-ink">Works on</dt><dd className="m-0 text-right font-medium">{sideLabel(department.side)}</dd>
            <dt className="text-muted-ink">People</dt><dd className="m-0 text-right font-medium">{people}</dd>
          </dl>
          {closedNote && <p className="m-0 py-2 px-2.5 rounded-control bg-muted text-meta text-muted-ink">{closedNote}</p>}
          {!chart.canEdit && <p className="m-0 text-meta text-muted-ink">Only management can change this.</p>}
          <div className="py-2.5 px-3 rounded-control bg-muted text-copy">
            <b>{granted}</b> of {available} areas{full > 0 && <> · <b>{full}</b> Full</>}
          </div>
        </Card>
        <Card>
          <RoleGrid companies={companies} levels={levels} savedLevels={savedLevels} isLocked={isLocked} onChange={setLevels} />
        </Card>
      </div>

      {chart.canEdit && (
        <div className="sticky bottom-0 z-[2] flex items-center justify-between gap-3 flex-wrap py-3 px-4 rounded-card border border-solid border-line bg-card pb-[max(12px,env(safe-area-inset-bottom))]">
          <span className="text-meta text-muted-ink">
            {changedCount === 0 ? 'No unsaved changes.' : `${changedCount} ${changedCount === 1 ? 'area' : 'areas'} changed.`}
          </span>
          <span className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:min-h-11">
            <Button onClick={() => setLevels(savedLevels)} disabled={changedCount === 0 || isSaving} disabledReason="Nothing has changed yet.">Discard</Button>
            <Button variant="primary" onClick={save} loading={isSaving} disabled={changedCount === 0} disabledReason="Nothing has changed yet.">Save role</Button>
          </span>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
