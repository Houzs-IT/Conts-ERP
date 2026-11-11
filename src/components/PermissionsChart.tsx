import { useState } from 'react';
import { Card } from './Card';
import { Segmented } from './Metric';
import ListView from './permissions/ListView';
import RolePage from './permissions/RolePage';
import RolesView from './permissions/RolesView';
import { useAccessChart, type RoleTarget } from './permissions/shared';

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
  const [editing, setEditing] = useState<RoleTarget | null>(null);
  const { data: chart, error, reload } = useAccessChart();

  const showRoles = () => { setView('roles'); setEditing(null); };
  const finishEditing = () => { reload(); setEditing(null); };

  if (view === 'roles' && error && !chart) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  if (view === 'roles' && !chart) return <div className="p-5 text-copy text-muted-ink">Loading the roles…</div>;
  if (view === 'roles' && chart && editing) {
    return <RolePage chart={chart} target={editing} onBack={() => setEditing(null)} onSaved={finishEditing} />;
  }

  return (
    <Card>
      <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2.5">
        <Segmented label="Permissions view" value={view} onChange={setView} options={VIEWS} />
        <span className="text-meta text-muted-ink leading-[1.5]">{INTRO[view]}</span>
      </div>
      {view === 'roles' && chart && <RolesView chart={chart} onOpen={setEditing} />}
      {view === 'setup' && <ListView onGoToRoles={showRoles} />}
    </Card>
  );
}
