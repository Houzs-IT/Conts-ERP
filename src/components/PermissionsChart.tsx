import { useState } from 'react';
import { Card } from './Card';
import { useConfirm } from './ConfirmDialog';
import { Segmented } from './Metric';
import { cx } from '../lib/design-tokens';
import ListView from './permissions/ListView';
import RolePage from './permissions/RolePage';
import RolesView from './permissions/RolesView';
import { isSameRole, useAccessChart, type RoleTarget } from './permissions/shared';

type View = 'roles' | 'setup';

const VIEWS: { key: View; label: string }[] = [
  { key: 'roles', label: 'Roles' },
  { key: 'setup', label: 'Setup' },
];

const INTRO: Record<View, string> = {
  roles: 'Pick a role to see and change what it can do. Grouped by company, then department. The Staff row covers people with no position.',
  setup: 'The departments and positions people are placed in.',
};

export default function PermissionsChart() {
  const [view, setView] = useState<View>('roles');
  const [selectedRole, setSelectedRole] = useState<RoleTarget | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDialog, ask] = useConfirm();
  const { data: chart, error, reload } = useAccessChart();

  async function leaveRoleThen(next: () => void): Promise<void> {
    if (hasUnsavedChanges && (await ask({ title: 'Discard the unsaved changes?', confirmLabel: 'Discard changes', danger: true })) === null) return;
    setHasUnsavedChanges(false);
    next();
  }
  const switchView = (next: View) => leaveRoleThen(() => { setView(next); setSelectedRole(null); });
  const openRole = (target: RoleTarget) => (isSameRole(selectedRole, target) ? undefined : leaveRoleThen(() => setSelectedRole(target)));
  const closeRole = () => leaveRoleThen(() => setSelectedRole(null));

  if (view === 'roles' && error && !chart) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  if (view === 'roles' && !chart) return <div className="p-5 text-copy text-muted-ink">Loading the roles…</div>;

  const isRoleOpen = view === 'roles' && selectedRole !== null;

  return (
    <Card style={{ overflow: 'clip' }}>
      <div className={cx('py-3 px-5 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2.5', isRoleOpen && 'max-lg:hidden')}>
        <Segmented label="Permissions view" value={view} onChange={switchView} options={VIEWS} />
        <span className="text-meta text-muted-ink leading-[1.5]">{INTRO[view]}</span>
      </div>
      {view === 'roles' && chart && (
        <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <div className={cx('lg:sticky lg:top-0 lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto lg:[border-right:1px_solid_var(--color-line)]', isRoleOpen && 'max-lg:hidden')}>
            <RolesView chart={chart} selectedRole={selectedRole} onOpen={openRole} />
          </div>
          <div className={cx('min-w-0', !isRoleOpen && 'max-lg:hidden')}>
            {selectedRole ? (
              <RolePage key={`${selectedRole.departmentId}:${selectedRole.positionId ?? ''}`} chart={chart} target={selectedRole}
                onBack={closeRole} onSaved={reload} onDirtyChange={setHasUnsavedChanges} />
            ) : (
              <p className="m-0 p-8 text-center text-copy text-muted-ink">Pick a role on the left to see and change what it can do.</p>
            )}
          </div>
        </div>
      )}
      {view === 'setup' && <ListView onGoToRoles={() => switchView('roles')} />}
      {confirmDialog}
    </Card>
  );
}
