import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { ConfirmDialog, type ConfirmSpec } from '../ConfirmDialog';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import type { AccessLevel, AccessOrigin, PersonAccess, PersonAccessArea, PersonAccessChange } from '../../lib/types';
import { LEVEL_COLOR, LEVEL_LABEL, MUTED, ORIGIN_LABEL, SELECT, TAG, closedBySide } from './shared';

const LEVELS: AccessLevel[] = ['none', 'view', 'edit', 'full'];

/**
 * The Access section of Edit user: every area with the level this person gets, where it comes from (Dept, Position or
 * Custom) and a dropdown to set their own level. "Inherit" removes their own setting, so they follow their position,
 * then their department. Read from the server only once the section is opened. Saves on its own button, apart from the
 * form's Save changes, and sends only the areas that changed.
 */
export default function UserAccess({ userId }: { userId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PersonAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  // area -> the level picked but not yet saved; null puts the area back on the position default
  const [draft, setDraft] = useState<Record<string, AccessLevel | null>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let live = true;
    api.get<PersonAccess>(`/users/${userId}/access`)
      .then(res => { if (live) { setData(res); setError(null); } })
      .catch(e => { if (live) setError(errorMessage(e, 'Their access could not be loaded.')); });
    return () => { live = false; };
  }, [open, data, userId]);

  const pending = Object.keys(draft).length;

  async function send(body: { changes: PersonAccessChange[] } | { resetAll: true }, done: string) {
    setBusy(true);
    try {
      setData(await api.put<PersonAccess>(`/users/${userId}/access`, body));
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

  /** The area as it will read once the draft is saved: a picked level is Custom, Inherit shows the default again. */
  function shown(a: PersonAccessArea): { level: AccessLevel; origin: AccessOrigin; override: AccessLevel | null } {
    const d = draft[a.key];
    if (d === undefined) return { level: a.level, origin: a.origin, override: a.override };
    return d === null ? { level: a.inherited.level, origin: a.inherited.origin, override: null } : { level: d, origin: 'user', override: d };
  }
  const pick = (a: PersonAccessArea, value: string) => {
    const next = value === 'inherit' ? null : (value as AccessLevel);
    setDraft(prev => {
      const copy = { ...prev };
      // Picking what is already saved clears the pending change.
      if (next === a.override) delete copy[a.key]; else copy[a.key] = next;
      return copy;
    });
  };

  const fixed = data && data.user.kind !== 'staff';
  const overridden = data?.areas.filter(a => shown(a).override !== null).length ?? 0;
  const groups = new Map<string, PersonAccessArea[]>();
  for (const a of data?.areas ?? []) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);

  return (
    <details onToggle={e => setOpen(e.currentTarget.open)} className="rounded-card border border-solid border-line bg-card overflow-hidden">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none py-3 px-4 flex items-center justify-between gap-3 text-copy font-medium text-ink hover:bg-muted">
        <span className="flex items-center gap-2"><Icon name="ShieldCheck" size="sm" />Access</span>
        <Icon name="ChevronDown" size="sm" style={{ transition: 'transform 120ms ease-out' }} />
      </summary>
      {open && (
        <div className="[border-top:1px_solid_var(--color-line-soft)] flex flex-col">
          {error && <div className="p-4 text-copy text-muted-ink">{error}</div>}
          {!data && !error && <div className="p-4 text-copy text-muted-ink">Loading their access…</div>}
          {data && fixed && (
            <div className="p-4 text-copy text-muted-ink">
              {data.user.kind === 'management'
                ? 'Full (Management). Management always has full access to everything and it cannot be changed.'
                : 'Field app only. Their department uses the field app, so there are no desk areas to set.'}
            </div>
          )}
          {data && !fixed && (
            <>
              <div className="py-3 px-4 text-meta text-muted-ink leading-[1.5] [border-bottom:1px_solid_var(--color-line-soft)]">
                {data.user.positionName ?? 'No position'} in {data.user.departmentName ?? 'no department'}. They get what their position gives, then their department.
                {data.canEdit ? ' Pick a level to give this person their own setting for an area.' : ' Only management can change this.'}
              </div>
              <div className="max-h-[340px] overflow-y-auto">
                {[...groups.entries()].map(([group, areas]) => (
                  <div key={group}>
                    <div className="py-1.5 px-4 bg-page [border-bottom:1px_solid_var(--color-line-soft)] text-caption font-semibold tracking-[0.06em] uppercase text-muted-ink">{group}</div>
                    {areas.map(a => {
                      const s = shown(a);
                      // Their department's side closes this category: nothing they are given opens it.
                      const closed = closedBySide(data.user.kind, data.user.side, a.group);
                      const custom = !closed && s.override !== null;
                      return (
                        <div key={a.key} className={cx('py-1.5 px-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center [border-bottom:1px_solid_var(--color-line-soft)]',
                          custom && 'bg-info-bg')}>
                          <div className="min-w-0 flex items-center gap-2 flex-wrap">
                            <span className="text-copy font-medium">{a.label}</span>
                            <span className="text-meta font-semibold" style={{ color: LEVEL_COLOR[closed ? 'none' : s.level] }}>{closed ? 'No access (closed by side)' : LEVEL_LABEL[s.level]}</span>
                            {!closed && <span className={TAG} style={custom
                              ? { background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }
                              : { color: MUTED, borderColor: 'var(--color-line)' }}>{ORIGIN_LABEL[s.origin]}</span>}
                          </div>
                          {data.canEdit ? (
                            <select aria-label={`${a.label} access for ${data.user.fullName}`} value={s.override ?? 'inherit'} disabled={busy || closed}
                              onChange={e => pick(a, e.target.value)}
                              className={cx(SELECT, 'max-w-[230px]', custom ? 'font-semibold' : 'font-normal')}
                              style={{ color: custom ? LEVEL_COLOR[s.level] : MUTED, borderColor: draft[a.key] !== undefined ? 'var(--color-gold)' : 'var(--color-line)' }}>
                              <option value="inherit">Inherit (position default: {LEVEL_LABEL[a.inherited.level]})</option>
                              {LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                            </select>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {data.canEdit && (
                <div className="py-2.5 px-4 flex items-center justify-between gap-3 flex-wrap bg-page [border-top:1px_solid_var(--color-line)]">
                  <Button size="sm" disabled={busy || overridden === 0 && pending === 0} onClick={() => setConfirm({
                    title: `Reset ${data.user.fullName} to the position default?`,
                    body: 'Every setting made just for this person is removed. They follow their position and department again.',
                    confirmLabel: 'Reset all', busyLabel: 'Resetting…',
                    onConfirm: async () => { setConfirm(null); await send({ resetAll: true }, 'Access reset to the position default.'); },
                  })}>Reset all to position default</Button>
                  <span className="flex items-center gap-2">
                    <span className="text-meta text-muted-ink">{pending === 0 ? 'No unsaved changes.' : `${pending} unsaved.`}</span>
                    <Button size="sm" onClick={() => setDraft({})} disabled={pending === 0 || busy}>Discard</Button>
                    <Button size="sm" variant="primary" onClick={save} loading={busy} disabled={pending === 0}>Save access</Button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </details>
  );
}
