import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import { SearchSelect } from '../Select';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmDialog';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import type { AccessLevel, AccessOrigin, PersonAccess, PersonAccessArea } from '../../lib/types';
import { LevelBoxes, TIERS } from './LevelBoxes';
import { LEVEL_LABEL, MUTED, ORIGIN_LABEL, TAG, closedBySide } from './shared';

interface Person { id: string; fullName: string; department: string | null; position: string | null; isActive: boolean }

// Phone: name and three narrow box columns fit the screen, and the origin tag / Reset cell drops under the name.
const GRID = 'grid gap-x-2.5 items-center px-5 grid-cols-[minmax(200px,1fr)_repeat(3,64px)_150px] max-md:px-4 max-md:gap-x-1 max-md:grid-cols-[minmax(0,1fr)_repeat(3,40px)]';

/**
 * View 3 of the Permissions tab: one person at a time. Each area shows the level the person gets (lighter when they
 * follow their position and department) and where it comes from. Ticking a box gives this person their own setting for
 * the area; Reset puts them back on their position. The same service as Edit user > Access, so both stay in step.
 */
export default function UsersView({ onDirty }: { onDirty: (pending: number) => void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [data, setData] = useState<PersonAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  // area -> the level picked but not yet saved; null puts the area back on the position default
  const [draft, setDraft] = useState<Record<string, AccessLevel | null>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDialog, ask] = useConfirm();

  useEffect(() => {
    let live = true;
    api.get<{ data: Person[] }>('/users')
      .then(res => { if (live) setPeople(res.data.filter(p => p.isActive)); })
      .catch(e => { if (live) setPeopleError(errorMessage(e, 'The people could not be loaded.')); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    setData(null); setError(null);
    api.get<PersonAccess>(`/users/${userId}/access`)
      .then(res => { if (live) setData(res); })
      .catch(e => { if (live) setError(errorMessage(e, 'Their access could not be loaded.')); });
    return () => { live = false; };
  }, [userId]);

  const pending = Object.keys(draft).length;
  useEffect(() => { onDirty(pending); }, [pending, onDirty]);

  const options = useMemo(() => (people ?? []).map(p => ({
    value: p.id, label: p.fullName, hint: [p.position, p.department].filter(Boolean).join(' · ') || undefined,
    keywords: [p.position, p.department].filter(Boolean).join(' '),
  })), [people]);

  const groups = useMemo(() => {
    const m = new Map<string, PersonAccessArea[]>();
    for (const a of data?.areas ?? []) m.set(a.group, [...(m.get(a.group) ?? []), a]);
    return [...m.entries()];
  }, [data]);

  if (peopleError) return <div className="p-5 text-copy text-muted-ink">{peopleError}</div>;
  if (!people) return <div className="p-5 text-copy text-muted-ink">Loading the people…</div>;

  const canEdit = !!data?.canEdit && !busy;
  const fixed = !!data && data.user.kind !== 'staff';
  const overridden = data?.areas.filter(a => shown(a).override !== null).length ?? 0;

  /** The area as it will read once the draft is saved: a picked level is Custom, Reset shows the default again. */
  function shown(a: PersonAccessArea): { level: AccessLevel; origin: AccessOrigin; override: AccessLevel | null } {
    const d = draft[a.key];
    if (d === undefined) return { level: a.level, origin: a.origin, override: a.override };
    return d === null ? { level: a.inherited.level, origin: a.inherited.origin, override: null } : { level: d, origin: 'user', override: d };
  }
  const pick = (a: PersonAccessArea, next: AccessLevel | null) => {
    setDraft(prev => {
      const copy = { ...prev };
      // Picking what is already saved clears the pending change.
      if (next === a.override) delete copy[a.key]; else copy[a.key] = next;
      return copy;
    });
  };

  const switchTo = async (id: string) => {
    if (id === userId) return;
    if (pending > 0 && (await ask({ title: 'Discard the unsaved changes?', confirmLabel: 'Discard changes', danger: true })) === null) return;
    setDraft({}); setUserId(id);
  };

  async function send(body: { changes: { area: string; level: AccessLevel | null }[] } | { resetAll: true }, done: string): Promise<void> {
    if (!data) return;
    setBusy(true);
    try {
      setData(await api.put<PersonAccess>(`/users/${data.user.id}/access`, body));
      setDraft({});
      toast({ tone: 'success', title: done, body: 'It applies the next time they open or refresh the system.' });
    } catch (e) {
      toast({ tone: 'critical', title: 'Their access was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  }
  const save = () => send({ changes: Object.entries(draft).map(([area, level]) => ({ area, level })) },
    `${pending} access ${pending === 1 ? 'change' : 'changes'} saved.`);
  const resetAll = async () => {
    if (!data) return;
    const ok = await ask({
      title: `Reset ${data.user.fullName} to the position default?`,
      body: 'Every setting made just for this person is removed. They follow their position and department again.',
      confirmLabel: 'Reset all', danger: true,
    });
    if (ok !== null) await send({ resetAll: true }, 'Access reset to the position default.');
  };

  return (
    <>
      {confirmDialog}
      <div className="flex items-end gap-3 flex-wrap py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <SearchSelect label="Person" showLabel size="md" className="min-w-[260px]" placeholder="Search a person" value={userId}
          onChange={v => void switchTo(v)} options={options} />
        {data && <span className="text-meta text-muted-ink pb-2.5">{data.user.positionName ?? 'No position'} in {data.user.departmentName ?? 'no department'}</span>}
      </div>
      <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink leading-[1.5]">
        A person gets what their position gives, then their department. Tick a box to give this person their own setting for an area,
        which beats both. Reset puts the area back on their position.
      </div>
      {!userId ? (
        <div className="p-5 text-copy text-muted-ink">Pick a person to see and set their access.</div>
      ) : error ? (
        <div className="p-5 text-copy text-muted-ink">{error}</div>
      ) : !data ? (
        <div className="p-5 text-copy text-muted-ink">Loading their access…</div>
      ) : fixed ? (
        <div className="p-5 text-copy text-muted-ink">
          {data.user.kind === 'management'
            ? 'Full (Management). Management always has full access to everything and it cannot be changed.'
            : 'Field app only. Their department uses the field app, so there are no desk areas to set.'}
        </div>
      ) : (
        <div className="md:overflow-auto md:max-h-[70vh]">
          <div className="md:min-w-[620px]">
            <div className={cx(GRID, 'sticky top-0 z-[2] py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-ink')}>
              <div className="text-muted-ink">Category and area</div>
              {TIERS.map(t => <div key={t.level} className="text-center">{t.label}</div>)}
              <div className="max-md:hidden" />
            </div>
            {groups.map(([group, areas]) => (
              <div key={group}>
                <div className="px-5 max-md:px-4 py-2 bg-page [border-bottom:1px_solid_var(--color-line)] text-copy font-semibold text-ink">{group}</div>
                {areas.map(a => {
                  const s = shown(a);
                  // Their department's side closes this category: nothing they are given opens it.
                  const closed = closedBySide(data.user.kind, data.user.side, a.group);
                  const custom = !closed && s.override !== null;
                  return (
                    <div key={a.key} className={cx(GRID, 'py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                      <div className="pl-[18px] text-copy font-medium min-w-0">{a.label}</div>
                      <LevelBoxes level={closed ? 'none' : s.level} label={`${data.user.fullName} access to ${a.label}`} disabled={!canEdit || closed}
                        faded={!custom} changed={draft[a.key] !== undefined} onPick={next => pick(a, next)} />
                      <div className="flex items-center gap-1.5 min-w-0 max-md:col-span-full max-md:pl-[18px] max-md:pb-2">
                        {closed ? <span className="text-caption text-muted-ink">Closed by side</span> : (
                          <span title={custom ? 'Set just for this person' : `From their ${ORIGIN_LABEL[s.origin].toLowerCase()}: ${LEVEL_LABEL[s.level]}`} className={TAG}
                            style={custom
                              ? { background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }
                              : { color: MUTED, borderColor: 'var(--color-line)' }}>{ORIGIN_LABEL[s.origin]}</span>
                        )}
                        {custom && canEdit && <Button size="sm" variant="tertiary" onClick={() => pick(a, null)} aria-label={`Reset ${a.label} to the position default`}>Reset</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {data?.canEdit && !fixed && (
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap bg-page [border-top:1px_solid_var(--color-line)]">
          <Button onClick={() => void resetAll()} disabled={busy || (overridden === 0 && pending === 0)}>Reset all to position default</Button>
          <span className="flex items-center gap-2">
            <span className="text-meta text-muted-ink">{pending === 0 ? 'No unsaved changes.' : `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}.`}</span>
            <Button onClick={() => setDraft({})} disabled={pending === 0 || busy}>Discard</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy} disabled={pending === 0}>Save changes</Button>
          </span>
        </div>
      )}
    </>
  );
}
