import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { CloseButton } from './CloseButton';
import Icon from './Icon';
import { useToast } from './Toast';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';

export interface CategoryTreeSub { code: string; label: string }
export interface CategoryTreeGroup { code: string; label: string; subs: CategoryTreeSub[] }

/** What the server stores for one person. `subs` holds "GROUP/SUB" codes. */
export interface CategoryChoice { groups: string[]; subs: string[]; other: boolean }
/** GET and PUT /users/:id/category-access. `restricted` false: the person sees everything. */
export interface PersonCategoryAccess extends CategoryChoice { userId: string; restricted: boolean }

export const subKey = (group: string, sub: string): string => `${group}/${sub}`;

type BoxState = 'on' | 'partial' | 'off';

/** The same text for the same ticks, whatever order they were made in. With All categories on the ticks do not count
 *  (nothing is stored for them), so they never read as an unsaved change. */
const draftKey = (all: boolean, groups: ReadonlySet<string>, subs: ReadonlySet<string>, other: boolean): string =>
  all ? 'all' : JSON.stringify([[...groups].sort(), [...subs].sort(), other]);

const keyOf = (a: PersonCategoryAccess): string => draftKey(!a.restricted, new Set(a.groups), new Set(a.subs), a.other);

function Tick({ state, label, onChange }: { state: BoxState; label: string; onChange: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  // The in-between look cannot be set from markup.
  useEffect(() => { if (box.current) box.current.indeterminate = state === 'partial'; }, [state]);
  return <input ref={box} type="checkbox" className="w-4 h-4 flex-none cursor-pointer accent-ink" checked={state === 'on'} aria-label={label} onChange={onChange} />;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('flex-none w-[42px] h-6 rounded-full border-none p-0.5 cursor-pointer flex items-center',
        '[transition:background_var(--motion-fast)_var(--ease-out)]', checked ? 'bg-ink justify-end' : 'bg-line-strong justify-start')}>
      <span className="w-5 h-5 rounded-full bg-white [box-shadow:0_1px_2px_rgba(21,21,21,0.25)]" />
    </button>
  );
}

/**
 * One person's product categories, in a drawer: which categories and sub-categories they see on the renovation beta
 * project screens (the PO, Client PO and VO tabs). All categories (the default) hides nothing; switched off, only the
 * ticked groups, sub-categories and Uncategorised lines are shown. Reads the person on opening and saves on its own
 * button (PUT /users/:id/category-access).
 */
export default function CategoryAccessEditor({ person, catalog, onClose, onSaved }: {
  person: { id: string; fullName: string; job: string };
  catalog: CategoryTreeGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<PersonCategoryAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // What is on screen, and what the server has (so Discard goes back to the last saved ticks, not the first ones).
  const [all, setAll] = useState(true);
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const [subs, setSubs] = useState<ReadonlySet<string>>(new Set());
  const [other, setOther] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [base, setBase] = useState<PersonCategoryAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setError(null);
    api.get<PersonCategoryAccess>(`/users/${person.id}/category-access`)
      .then(res => { if (live) setLoaded(res); })
      .catch((e: unknown) => { if (live) setError(errorMessage(e, 'Their category access could not be loaded.')); });
    return () => { live = false; };
  }, [person.id, attempt]);

  function show(a: PersonCategoryAccess) {
    setAll(!a.restricted);
    setGroups(new Set(a.groups));
    setSubs(new Set(a.subs));
    setOther(a.other);
  }

  // Fill the form from the server once it answers. Not again when the page reloads its list after a save: that would
  // put the ticks back to what they were before the save.
  useEffect(() => {
    if (!loaded) return;
    show(loaded);
    setBase(loaded);
    setSaveError(null);
    const ticked = new Set(loaded.subs);
    setOpen(new Set(catalog.filter(g => g.subs.some(s => ticked.has(subKey(g.code, s.code)))).map(g => g.code)));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- `catalog` only picks which groups start open

  const nothingTicked = !all && groups.size === 0 && subs.size === 0 && !other;
  const dirty = base !== null && draftKey(all, groups, subs, other) !== keyOf(base);

  const stateOf = (g: CategoryTreeGroup): BoxState => {
    if (groups.has(g.code)) return 'on';
    return g.subs.some(s => subs.has(subKey(g.code, s.code))) ? 'partial' : 'off';
  };

  function toggleGroup(g: CategoryTreeGroup) {
    const nextGroups = new Set(groups);
    const nextSubs = new Set(subs);
    if (nextGroups.has(g.code)) nextGroups.delete(g.code);
    else {
      // Off or part ticked: tick the whole group, so its single sub-category ticks are no longer needed.
      nextGroups.add(g.code);
      for (const s of g.subs) nextSubs.delete(subKey(g.code, s.code));
    }
    setGroups(nextGroups);
    setSubs(nextSubs);
  }

  function toggleSub(g: CategoryTreeGroup, sub: CategoryTreeSub) {
    const nextGroups = new Set(groups);
    const nextSubs = new Set(subs);
    const key = subKey(g.code, sub.code);
    if (nextGroups.has(g.code)) {
      // The group was ticked whole: untick this one and keep the others one by one.
      nextGroups.delete(g.code);
      for (const s of g.subs) if (s.code !== sub.code) nextSubs.add(subKey(g.code, s.code));
    } else if (!nextSubs.delete(key)) nextSubs.add(key);
    setGroups(nextGroups);
    setSubs(nextSubs);
  }

  const toggleOpen = (code: string) => setOpen(prev => {
    const next = new Set(prev);
    if (!next.delete(code)) next.add(code);
    return next;
  });

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await api.put<PersonCategoryAccess>(`/users/${person.id}/category-access`, { restricted: !all, groups: [...groups], subs: [...subs], other });
      setBase(saved);
      toast({ tone: 'success', title: all ? `${person.fullName} sees all categories.` : 'Category access saved.', body: 'It applies the next time they open or refresh a project.' });
      onSaved();
    } catch (e) {
      setSaveError(errorMessage(e, 'Category access was not saved. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span id="category-access-title" className="text-heading font-semibold [overflow-wrap:anywhere]">{person.fullName}</span>
          {person.job && <span className="text-meta text-muted-ink">{person.job}</span>}
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className="py-3 px-5 text-meta text-muted-ink leading-[1.5] [border-bottom:1px_solid_var(--color-line-soft)]">
        Choose which product categories this person sees on the renovation project screens (the PO, Client PO and VO tabs).
        Lines in the other categories are hidden from them. The main Supply Chain screens are not covered yet.
      </div>

      {error && (
        <div className="p-5 flex flex-col gap-3 items-start">
          <span className="text-copy text-ink" role="alert">{error}</span>
          <Button size="sm" onClick={() => setAttempt(n => n + 1)}>Try again</Button>
        </div>
      )}
      {!loaded && !error && <div className="p-5 text-copy text-muted-ink" role="status">Loading their category access…</div>}

      {loaded && (
        <>
          <label className="flex items-center justify-between gap-3 py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-copy font-medium">All categories</span>
              <span className="text-meta text-muted-ink">{all ? 'Nothing is hidden from this person.' : 'Only what is ticked below is shown.'}</span>
            </span>
            <Switch label="All categories" checked={all} onChange={setAll} />
          </label>

          {!all && (
            <div className="flex flex-col">
              {catalog.map(g => {
                const state = stateOf(g);
                const isOpen = open.has(g.code);
                const picked = g.subs.filter(s => subs.has(subKey(g.code, s.code))).length;
                return (
                  <div key={g.code} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                    <div className="flex items-center gap-2.5 py-2.5 px-5 hover:bg-muted">
                      <Tick state={state} label={g.label} onChange={() => toggleGroup(g)} />
                      <button type="button" onClick={() => toggleOpen(g.code)} aria-expanded={isOpen}
                        className="flex-1 min-w-0 flex items-center gap-2 bg-transparent border-none p-0 cursor-pointer font-[inherit] text-left text-ink">
                        <span className="text-copy font-medium truncate">{g.label}</span>
                        <span className="text-caption text-muted-ink tabular-nums">{state === 'on' ? 'All' : `${picked} of ${g.subs.length}`}</span>
                        <span className="ml-auto flex text-muted-ink" style={{ transition: 'transform 120ms ease-out', transform: isOpen ? 'none' : 'rotate(-90deg)' }}>
                          <Icon name="ChevronDown" size="sm" />
                        </span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="bg-muted py-1">
                        {g.subs.map(s => (
                          <label key={s.code} className="flex items-center gap-2.5 py-1.5 pl-[52px] pr-5 cursor-pointer">
                            <Tick state={state === 'on' || subs.has(subKey(g.code, s.code)) ? 'on' : 'off'} label={`${g.label}, ${s.label}`} onChange={() => toggleSub(g, s)} />
                            <span className="text-copy text-ink">{s.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <label className="flex items-center gap-2.5 py-2.5 px-5 cursor-pointer [border-bottom:1px_solid_var(--color-line-soft)]">
                <Tick state={other ? 'on' : 'off'} label="Uncategorised" onChange={() => setOther(v => !v)} />
                <span className="flex flex-col">
                  <span className="text-copy font-medium">Uncategorised</span>
                  <span className="text-meta text-muted-ink">Products that have no category yet.</span>
                </span>
              </label>
            </div>
          )}

          <div className="sticky bottom-0 mt-auto flex flex-col gap-2 py-3 px-5 bg-card [border-top:1px_solid_var(--color-line)]">
            {saveError && <span className="text-meta text-ink" role="alert">{saveError}</span>}
            {!saveError && nothingTicked && <span className="text-meta text-muted-ink">Tick at least one category, or switch All categories back on.</span>}
            {!saveError && !nothingTicked && dirty && <span className="text-meta text-muted-ink">You have unsaved changes.</span>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={!dirty || busy} disabledReason="Nothing has changed." onClick={() => { if (base) show(base); setSaveError(null); }}>Discard</Button>
              <Button variant="primary" size="sm" loading={busy} disabled={!dirty || nothingTicked}
                disabledReason={nothingTicked ? 'Tick at least one category first.' : 'Nothing has changed.'} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
