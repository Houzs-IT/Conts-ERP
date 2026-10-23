import { useState } from 'react';
import { Card } from './Card';
import { ConfirmDialog } from './ConfirmDialog';
import { Segmented } from './Metric';
import DepartmentsView from './permissions/DepartmentsView';
import PositionsView from './permissions/PositionsView';
import ListView from './permissions/ListView';

type View = 'departments' | 'positions' | 'list';

const VIEWS: { key: View; label: string }[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'positions', label: 'Positions' },
  { key: 'list', label: 'Departments and positions' },
];

const INTRO: Record<View, string> = {
  departments: 'What each department can do in each part of the system. Set a level on a category and every area under it follows, unless the area has its own setting.',
  positions: 'What one position adds to or takes from its department.',
  list: 'The departments and positions people are placed in.',
};

/**
 * The Permissions tab: three views behind one switch. Access comes from three places, in this order: the person's own
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
