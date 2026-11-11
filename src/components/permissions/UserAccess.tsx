import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import { ConfirmDialog, type ConfirmSpec } from '../ConfirmDialog';
import Icon from '../Icon';
import { StaleBanner } from '../DataState';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { areaKeysOf, countChanged, countDifferences, personChanges, type RoleLevels } from '../../lib/roleGrid';
import type { AccessLevel, PersonAccess, PersonAccessArea, PersonAccessChange } from '../../lib/types';
import RoleGrid, { groupByCompany, type GridCategory } from './RoleGrid';
import { closedBySide, closedCompanyLabel, sideLabel } from './shared';

interface PersonAccessEditorProps {
  access: PersonAccess;
  onSaved: (next: PersonAccess) => void;
}

type PersonAccessUpdate = { changes: PersonAccessChange[] } | { resetAll: true };

function categoriesOf(access: PersonAccess): GridCategory[] {
  const categoriesByGroup = new Map<string, GridCategory>();
  for (const area of access.areas) {
    if (closedBySide(access.user.kind, access.user.side, area.group)) continue;
    const category = categoriesByGroup.get(area.group) ?? { group: area.group, areas: [] };
    category.areas.push({ key: area.key, label: area.label });
    categoriesByGroup.set(area.group, category);
  }
  return [...categoriesByGroup.values()];
}

const levelsOf = (access: PersonAccess, levelOf: (area: PersonAccessArea) => AccessLevel): RoleLevels =>
  Object.fromEntries(access.areas.map(area => [area.key, levelOf(area)]));

export default function UserAccess({ userId }: { userId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [access, setAccess] = useState<PersonAccess | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isOpen || access) return;
    let isCurrent = true;
    const load = async () => {
      try {
        const loaded = await api.get<PersonAccess>(`/users/${userId}/access`);
        if (isCurrent) { setAccess(loaded); setError(null); }
      } catch (loadError) {
        if (isCurrent) setError(errorMessage(loadError, 'Their access could not be loaded.'));
      }
    };
    void load();
    return () => { isCurrent = false; };
  }, [isOpen, access, userId, attempt]);

  const showSaved = (next: PersonAccess) => { setAccess(next); setSavedVersion(version => version + 1); };
  const isFixed = access !== null && access.user.kind !== 'staff';

  return (
    <details onToggle={event => setIsOpen(event.currentTarget.open)} className="rounded-card border border-solid border-line bg-card overflow-hidden">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none py-3 px-4 min-h-11 flex items-center justify-between gap-3 text-copy font-medium text-ink hover:bg-muted">
        <span className="flex items-center gap-2"><Icon name="ShieldCheck" size="sm" />Access</span>
        <Icon name="ChevronDown" size="sm" style={{ transition: 'transform 120ms ease-out' }} />
      </summary>
      {isOpen && (
        <div className="[border-top:1px_solid_var(--color-line-soft)] flex flex-col">
          {error && <div className="p-4"><StaleBanner message={error} onRetry={() => { setError(null); setAttempt(count => count + 1); }} /></div>}
          {!access && !error && <div className="p-4 text-copy text-muted-ink">Loading their access…</div>}
          {access && isFixed && (
            <div className="p-4 text-copy text-muted-ink">
              {access.user.kind === 'management'
                ? 'Full (Management). Management always has full access to everything and it cannot be changed.'
                : 'Field app only. Their department uses the field app, so there are no desk areas to set.'}
            </div>
          )}
          {access && !isFixed && <PersonAccessEditor key={savedVersion} access={access} onSaved={showSaved} />}
        </div>
      )}
    </details>
  );
}

function PersonAccessEditor({ access, onSaved }: PersonAccessEditorProps) {
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const categories = useMemo(() => categoriesOf(access), [access]);
  const companies = useMemo(() => groupByCompany(categories), [categories]);
  const areaKeys = useMemo(() => areaKeysOf(categories), [categories]);
  const savedLevels = useMemo(() => levelsOf(access, area => area.level), [access]);
  const roleLevels = useMemo(() => levelsOf(access, area => area.inherited.level), [access]);
  const [levels, setLevels] = useState(savedLevels);

  const { user, canEdit } = access;
  const changedCount = countChanged(savedLevels, levels, areaKeys);
  const ownSettingCount = countDifferences(savedLevels, roleLevels, areaKeys);
  const roleName = user.positionName ?? 'No position';
  const closedNote = user.side === 'both'
    ? null
    : `${user.fullName} works on ${sideLabel(user.side)} only. ${closedCompanyLabel(user.side)} areas are closed, so they are not shown.`;

  async function send(update: PersonAccessUpdate, successTitle: string) {
    setIsSaving(true);
    try {
      const next = await api.put<PersonAccess>(`/users/${user.id}/access`, update);
      toast({ tone: 'success', title: successTitle, body: 'It applies the next time they open or refresh the system.' });
      onSaved(next);
    } catch (saveError) {
      toast({ tone: 'critical', title: 'Their access was not saved.', body: errorMessage(saveError, 'Try again in a moment.') });
      setIsSaving(false);
    }
  }

  const save = () => send(
    { changes: personChanges(savedLevels, levels, roleLevels, areaKeys) },
    `${changedCount} access ${changedCount === 1 ? 'change' : 'changes'} saved.`,
  );
  const askResetAll = () => setConfirm({
    title: `Reset ${user.fullName} to their role?`,
    body: 'Every setting made just for this person is removed. They get exactly what their role gives again.',
    confirmLabel: 'Reset all', busyLabel: 'Resetting…',
    onConfirm: async () => { setConfirm(null); await send({ resetAll: true }, 'Access reset to their role.'); },
  });

  return (
    <>
      <div className="py-3 px-4 flex flex-col gap-1.5 text-meta text-muted-ink leading-[1.5] [border-bottom:1px_solid_var(--color-line-soft)]">
        <span>
          <b className="text-ink">{user.departmentName ?? 'No department'} / {roleName}</b>. The boxes start from what this role gives.
          {canEdit ? ' Change a box to give this person more (Extra) or less (Less) than the role.' : ' Only management can change this.'}
        </span>
        {closedNote && <span>{closedNote}</span>}
      </div>
      <div className="max-h-[440px] overflow-y-auto">
        <RoleGrid companies={companies} levels={levels} savedLevels={savedLevels} roleLevels={roleLevels}
          isLocked={!canEdit || isSaving} onChange={setLevels} />
      </div>
      {canEdit && (
        <div className="py-2.5 px-4 flex items-center justify-between gap-3 flex-wrap bg-page [border-top:1px_solid_var(--color-line)]">
          <Button size="sm" disabled={isSaving || ownSettingCount === 0} disabledReason="They already get exactly what their role gives." onClick={askResetAll}>
            Reset all to role
          </Button>
          <span className="flex items-center gap-2 max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:min-h-11">
            <span className="text-meta text-muted-ink max-md:hidden">{changedCount === 0 ? 'No unsaved changes.' : `${changedCount} unsaved.`}</span>
            <Button size="sm" onClick={() => setLevels(savedLevels)} disabled={changedCount === 0 || isSaving}>Discard</Button>
            <Button size="sm" variant="primary" onClick={save} loading={isSaving} disabled={changedCount === 0}>Save access</Button>
          </span>
        </div>
      )}
      <ConfirmDialog spec={confirm} busy={isSaving} onClose={() => setConfirm(null)} />
    </>
  );
}
