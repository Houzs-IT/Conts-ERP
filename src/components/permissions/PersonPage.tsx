import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import { ConfirmDialog, type ConfirmSpec } from '../ConfirmDialog';
import { StaleBanner } from '../DataState';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { plural, personName } from '../../lib/format';
import { areaKeysOf, countChanged, countDifferences, personChanges, type RoleLevels } from '../../lib/roleGrid';
import type { AccessLevel, PersonAccess, PersonAccessArea, PersonAccessChange } from '../../lib/types';
import { BackLink } from './MasterDetail';
import RoleGrid, { groupByCompany, type GridCategory } from './RoleGrid';
import { SaveBar } from './SaveBar';
import { closedBySide, closedCompanyLabel, sideLabel } from './shared';

export interface PersonPageProps {
  personId: string;
  onBack: () => void;
  onSaved: () => void;
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
}

interface PersonAccessEditorProps {
  access: PersonAccess;
  onBack: () => void;
  onSaved: (next: PersonAccess) => void;
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
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

const roleNameOf = (access: PersonAccess): string =>
  `${access.user.departmentName ?? 'No department'} / ${access.user.kind === 'management' ? 'Management' : access.user.positionName ?? 'Staff'}`;

export default function PersonPage({ personId, onBack, onSaved, onDirtyChange }: PersonPageProps) {
  const [access, setAccess] = useState<PersonAccess | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const load = async () => {
      try {
        const loaded = await api.get<PersonAccess>(`/users/${personId}/access`);
        if (isCurrent) { setAccess(loaded); setError(null); }
      } catch (loadError) {
        if (isCurrent) setError(errorMessage(loadError, 'Their access could not be loaded.'));
      }
    };
    void load();
    return () => { isCurrent = false; };
  }, [personId, attempt]);

  const showSaved = (next: PersonAccess) => { setAccess(next); setSavedVersion(version => version + 1); onSaved(); };

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-5 max-md:p-4">
        <BackLink label="People" onBack={onBack} />
        <StaleBanner message={error} onRetry={() => { setError(null); setAttempt(count => count + 1); }} />
      </div>
    );
  }
  if (!access) return <p className="m-0 p-5 text-copy text-muted-ink">Loading their access…</p>;
  if (access.user.kind !== 'staff') {
    return (
      <div className="flex flex-col gap-1.5 p-5 max-md:p-4">
        <BackLink label="People" onBack={onBack} />
        <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{personName(access.user.fullName)}</h2>
        <p className="m-0 text-copy text-muted-ink">
          {access.user.kind === 'management'
            ? 'Full (Management). Management always has full access to everything and it cannot be changed.'
            : 'Field app only. Their department uses the field app, so there are no desk areas to set.'}
        </p>
      </div>
    );
  }
  return <PersonAccessEditor key={savedVersion} access={access} onBack={onBack} onSaved={showSaved} onDirtyChange={onDirtyChange} />;
}

function PersonAccessEditor({ access, onBack, onSaved, onDirtyChange }: PersonAccessEditorProps) {
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
  const hasUnsavedChanges = changedCount > 0;
  useEffect(() => { onDirtyChange(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);

  const ownSettingCount = countDifferences(savedLevels, roleLevels, areaKeys);
  const closedNote = user.side === 'both'
    ? null
    : `${personName(user.fullName)} works on ${sideLabel(user.side)} only. ${closedCompanyLabel(user.side)} areas are closed, so they are not shown.`;

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
    `${personName(user.fullName)}: ${plural(changedCount, 'change')} saved.`,
  );
  const askResetAll = () => setConfirm({
    title: `Reset ${personName(user.fullName)} to their role?`,
    body: 'Every setting made just for this person is removed. They get exactly what their role gives again.',
    confirmLabel: 'Reset all', busyLabel: 'Resetting…',
    onConfirm: async () => { setConfirm(null); await send({ resetAll: true }, 'Access reset to their role.'); },
  });

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3.5 max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
        <BackLink label="People" onBack={onBack} />
        <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{personName(user.fullName)}</h2>
        <span className="text-meta text-muted-ink">{roleNameOf(access)} · {sideLabel(user.side)}</span>
        <span className="text-copy">
          {ownSettingCount === 0 ? 'Gets exactly what their role gives.' : <><b>{ownSettingCount}</b> {ownSettingCount === 1 ? 'area differs' : 'areas differ'} from their role.</>}
        </span>
        <span className="text-meta text-muted-ink">
          {canEdit ? 'The boxes start from the role. Change one to give this person more (Extra) or less (Less).' : 'Only management can change this.'}
        </span>
        {closedNote && <p className="m-0 mt-1 py-2 px-2.5 rounded-control bg-muted text-meta text-muted-ink">{closedNote}</p>}
      </div>

      <RoleGrid companies={companies} levels={levels} savedLevels={savedLevels} roleLevels={roleLevels}
        isLocked={!canEdit || isSaving} onChange={setLevels} />

      {canEdit && (
        <SaveBar>
          <Button size="sm" disabled={isSaving || ownSettingCount === 0} disabledReason="They already get exactly what their role gives." onClick={askResetAll}>
            Reset all to role
          </Button>
          <span className="flex items-center gap-2 max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:min-h-11">
            <span className="text-meta text-muted-ink max-md:hidden">{changedCount === 0 ? 'No unsaved changes.' : `${changedCount} unsaved.`}</span>
            <Button onClick={() => setLevels(savedLevels)} disabled={changedCount === 0 || isSaving}>Discard</Button>
            <Button variant="primary" onClick={save} loading={isSaving} disabled={changedCount === 0}>Save access</Button>
          </span>
        </SaveBar>
      )}
      <ConfirmDialog spec={confirm} busy={isSaving} onClose={() => setConfirm(null)} />
    </div>
  );
}
