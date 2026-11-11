import { useState } from 'react';
import { Card } from './Card';
import { useConfirm } from './ConfirmDialog';
import { Segmented } from './Metric';
import { cx } from '../lib/design-tokens';
import ListView from './permissions/ListView';
import { MasterDetail } from './permissions/MasterDetail';
import PeopleView from './permissions/PeopleView';
import PersonPage from './permissions/PersonPage';
import RolePage from './permissions/RolePage';
import RolesView from './permissions/RolesView';
import { isSameRole, useAccessChart, type RoleTarget } from './permissions/shared';

type View = 'roles' | 'people' | 'setup';

const VIEWS: { key: View; label: string }[] = [
  { key: 'roles', label: 'Roles' },
  { key: 'people', label: 'People' },
  { key: 'setup', label: 'Setup' },
];

const INTRO: Record<View, string> = {
  roles: 'Pick a role to see and change what it can do. Grouped by company, then department. The Staff row covers people with no position.',
  people: 'Pick a person to give them more or less than their role. Custom shows how many areas are set just for them.',
  setup: 'The departments and positions people are placed in.',
};

export default function PermissionsChart() {
  const [view, setView] = useState<View>('roles');
  const [selectedRole, setSelectedRole] = useState<RoleTarget | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDialog, ask] = useConfirm();
  const { data: chart, error, reload } = useAccessChart();

  async function leaveThen(next: () => void): Promise<void> {
    if (hasUnsavedChanges && (await ask({ title: 'Discard the unsaved changes?', confirmLabel: 'Discard changes', danger: true })) === null) return;
    setHasUnsavedChanges(false);
    next();
  }
  const switchView = (next: View) => leaveThen(() => { setView(next); setSelectedRole(null); setSelectedPersonId(null); });
  const openRole = (target: RoleTarget) => (isSameRole(selectedRole, target) ? undefined : leaveThen(() => setSelectedRole(target)));
  const openPerson = (personId: string) => (personId === selectedPersonId ? undefined : leaveThen(() => setSelectedPersonId(personId)));
  const closeRole = () => leaveThen(() => setSelectedRole(null));
  const closePerson = () => leaveThen(() => setSelectedPersonId(null));

  if (view !== 'setup' && error && !chart) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  if (view !== 'setup' && !chart) return <div className="p-5 text-copy text-muted-ink">Loading permissions…</div>;

  const isDetailOpen = (view === 'roles' && selectedRole !== null) || (view === 'people' && selectedPersonId !== null);

  return (
    <Card className="w-full max-w-[1120px]" style={{ overflow: 'clip' }}>
      <div className={cx('py-3 px-5 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2.5', isDetailOpen && 'max-lg:hidden')}>
        <Segmented label="Permissions view" value={view} onChange={switchView} options={VIEWS} />
        <span className="text-meta text-muted-ink leading-[1.5]">{INTRO[view]}</span>
      </div>
      {view === 'roles' && chart && (
        <MasterDetail
          list={<RolesView chart={chart} selectedRole={selectedRole} onOpen={openRole} />}
          detail={selectedRole ? (
            <RolePage key={`${selectedRole.departmentId}:${selectedRole.positionId ?? ''}`} chart={chart} target={selectedRole}
              onBack={closeRole} onSaved={reload} onDirtyChange={setHasUnsavedChanges} />
          ) : null}
          emptyDetail="Pick a role on the left to see and change what it can do."
        />
      )}
      {view === 'people' && chart && (
        <MasterDetail
          list={<PeopleView chart={chart} selectedPersonId={selectedPersonId} onOpen={openPerson} />}
          detail={selectedPersonId ? (
            <PersonPage key={selectedPersonId} personId={selectedPersonId} onBack={closePerson} onSaved={reload} onDirtyChange={setHasUnsavedChanges} />
          ) : null}
          emptyDetail="Pick a person on the left to see and change their access."
        />
      )}
      {view === 'setup' && <ListView onGoToRoles={() => switchView('roles')} />}
      {confirmDialog}
    </Card>
  );
}
