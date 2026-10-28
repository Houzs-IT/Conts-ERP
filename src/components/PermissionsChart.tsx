import { useState } from 'react';
import { Card } from './Card';
import { ConfirmDialog } from './ConfirmDialog';
import { Segmented } from './Metric';
import DepartmentsView from './permissions/DepartmentsView';
import PositionsView from './permissions/PositionsView';
import UsersView from './permissions/UsersView';
import ListView from './permissions/ListView';

type View = 'departments' | 'positions' | 'users' | 'list';

// Short labels keep all four on one line on a phone.
const VIEWS: { key: View; label: string; short: string }[] = [
  { key: 'departments', label: 'Departments', short: 'Depts' },
  { key: 'positions', label: 'Positions', short: 'Positions' },
  { key: 'users', label: 'Users', short: 'Users' },
  { key: 'list', label: 'Departments and positions', short: 'Setup' },
];

const INTRO: Record<View, string> = {
  departments: 'What each department can do in each part of the system. Set a level on a category and every area under it follows, unless the area has its own setting.',
  positions: 'What one position adds to or takes from its department.',
  users: 'What one person gets, and the settings that are theirs alone. A setting made for a person beats their position and department.',
  list: 'The departments and positions people are placed in.',
};

/**
 * The Permissions tab: four views behind one switch. Access comes from three places, in this order: the person's own
 * settings (Edit user > Access), then their position, then their department. Only management can change any of it.
 * The view is local state because the page's tabs do not use the address either.
 */
export default function PermissionsChart() {
  const [view, setView] = useState<View>('departments');
  const [pending, setPending] = useState(0);
  const [asking, setAsking] = useState<View | null>(null);

  const go = (next: View) => {
    if (next === view) return;
    // Unsaved picks live in the view that made them: say so before they are lost.
    if (pending > 0) setAsking(next); else setView(next);
  };

  return (
    <Card>
      <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2.5">
        <Segmented label="Permissions view" value={view} onChange={go} options={VIEWS} />
        <span className="text-meta text-muted-ink leading-[1.5]">{INTRO[view]}</span>
      </div>
      {view === 'departments' && <DepartmentsView onDirty={setPending} />}
      {view === 'positions' && <PositionsView onDirty={setPending} />}
      {view === 'users' && <UsersView onDirty={setPending} />}
      {view === 'list' && <ListView onGoToDepartments={() => go('departments')} />}
      <ConfirmDialog spec={asking ? {
        title: 'Discard the unsaved changes?',
        body: 'You picked levels that are not saved yet. Switching view throws them away.',
        confirmLabel: 'Discard and switch', cancelLabel: 'Stay here',
        onConfirm: () => { setPending(0); setView(asking); setAsking(null); },
      } : null} onClose={() => setAsking(null)} />
    </Card>
  );
}
