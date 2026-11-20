// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FORM_DRAFT_PREFIX, formDraftKey, readFormDraft, useFormDraft } from './formDraft';
import { createContentBoundKey } from './idempotency';
import { bindBrowserStorageIdentity, clearBrowserStorageIdentity } from './storageIdentity';

/* Long create/edit forms keep their unsaved fields in this browser (audit 20 Nov 2026, items 25-26): keyed by login,
   company, form and record; never restored by itself; cleared on save and on Discard. */

const keyOf = (form: string, id: string) => formDraftKey({ userId: 7, companyId: 0 }, form, id)!;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  act(() => { bindBrowserStorageIdentity(7); });
});
afterEach(() => {
  act(() => { clearBrowserStorageIdentity(); });
  vi.useRealTimers();
});

describe('formDraftKey', () => {
  it('keys by user, company, form and record, with "new" for a create form', () => {
    expect(formDraftKey({ userId: 7, companyId: 2 }, 'so-new', null)).toBe('u7:c2:so-new:new');
    expect(formDraftKey({ userId: 7, companyId: 2 }, 'po-edit', 'po-1')).toBe('u7:c2:po-edit:po-1');
    expect(formDraftKey(null, 'so-new', null)).toBeNull();
  });
});

describe('useFormDraft', () => {
  it('keeps what the person changed, not what the form opened with', () => {
    const { rerender } = renderHook(({ v }) => useFormDraft('so-new', null, v, { meaningful: v.name !== '' }), { initialProps: { v: { name: '' } } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readFormDraft(keyOf('so-new', 'new'))).toBeNull();
    rerender({ v: { name: 'Lim Mei Hua' } });
    act(() => { vi.advanceTimersByTime(600); });
    expect(readFormDraft<{ name: string }>(keyOf('so-new', 'new'))?.v.name).toBe('Lim Mei Hua');
  });

  it('does not keep a form prefilled from a source document until something is changed', () => {
    const { rerender } = renderHook(({ v, on }) => useFormDraft('si-new', 'DO-1', v, { enabled: on }), {
      initialProps: { v: { name: '' }, on: false },
    });
    rerender({ v: { name: '' }, on: true });
    rerender({ v: { name: 'From the DO' }, on: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readFormDraft(keyOf('si-new', 'DO-1'))).toBeNull();
    rerender({ v: { name: 'Changed' }, on: true });
    act(() => { vi.advanceTimersByTime(600); });
    expect(readFormDraft<{ name: string }>(keyOf('si-new', 'DO-1'))?.v.name).toBe('Changed');
  });

  it('offers an earlier draft without applying it; Restore hands it over, Discard deletes it', () => {
    localStorage.setItem(FORM_DRAFT_PREFIX + keyOf('so-new', 'new'), JSON.stringify({ v: { f: { name: 'old' }, k: null }, ts: Date.now(), version: null }));
    const { result } = renderHook(() => useFormDraft('so-new', null, { name: '' }));
    expect(result.current.offered?.v).toEqual({ name: 'old' });
    const apply = vi.fn();
    act(() => { result.current.restore(apply); });
    expect(apply).toHaveBeenCalledWith({ name: 'old' });
    expect(result.current.offered).toBeNull();

    localStorage.setItem(FORM_DRAFT_PREFIX + keyOf('pv-new', 'pv'), JSON.stringify({ v: { f: { name: 'x' }, k: null }, ts: Date.now(), version: null }));
    const pv = renderHook(() => useFormDraft('pv-new', 'pv', { name: '' }));
    act(() => { pv.result.current.discard(); });
    expect(readFormDraft(keyOf('pv-new', 'pv'))).toBeNull();
  });

  it('clears the draft after a successful save', () => {
    const { result, rerender } = renderHook(({ v }) => useFormDraft('pi-new', null, v), { initialProps: { v: { ref: '' } } });
    act(() => { vi.advanceTimersByTime(400); });
    rerender({ v: { ref: 'INV-77' } });
    act(() => { vi.advanceTimersByTime(600); });
    expect(readFormDraft(keyOf('pi-new', 'new'))).not.toBeNull();
    act(() => { result.current.clear(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readFormDraft(keyOf('pi-new', 'new'))).toBeNull();
  });

  it('never offers one login\'s draft to another', () => {
    localStorage.setItem(FORM_DRAFT_PREFIX + formDraftKey({ userId: 8, companyId: 0 }, 'so-new', null), JSON.stringify({ v: { f: { name: 'theirs' }, k: null }, ts: Date.now(), version: null }));
    const { result } = renderHook(() => useFormDraft('so-new', null, { name: '' }));
    expect(result.current.offered).toBeNull();
  });

  it('reads and writes nothing before the login is known', () => {
    act(() => { clearBrowserStorageIdentity(); });
    const { result, rerender } = renderHook(({ v }) => useFormDraft('so-new', null, v), { initialProps: { v: { name: '' } } });
    rerender({ v: { name: 'x' } });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.offered).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(FORM_DRAFT_PREFIX))).toEqual([]);
  });

  it('drops the old draft when the person types instead of answering the bar', () => {
    const put = (name: string) => localStorage.setItem(FORM_DRAFT_PREFIX + keyOf('so-new', 'new'), JSON.stringify({ v: { f: { name }, k: null }, ts: Date.now(), version: null }));
    put('old');
    const { result, rerender } = renderHook(({ v }) => useFormDraft('so-new', null, v), { initialProps: { v: { name: '' } } });
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.offered?.v).toEqual({ name: 'old' });
    rerender({ v: { name: 'n' } });
    expect(result.current.offered).toBeNull();
    act(() => { vi.advanceTimersByTime(600); });
    expect(readFormDraft<{ name: string }>(keyOf('so-new', 'new'))?.v.name).toBe('n');
  });

  it('keeps the save key with the draft, so a restored save whose answer was lost replays instead of duplicating', async () => {
    let n = 0;
    const keys = createContentBoundKey(() => `k${++n}`);
    const { rerender } = renderHook(({ v }) => useFormDraft('si-new', null, v, { keys }), { initialProps: { v: { name: '' } } });
    act(() => { vi.advanceTimersByTime(400); });
    rerender({ v: { name: 'Lim' } });
    act(() => { keys.keyFor({ debtorName: 'Lim' }); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(readFormDraft(keyOf('si-new', 'new'))?.k).toEqual({ key: 'k1', sig: JSON.stringify({ debtorName: 'Lim' }) });

    /* The page reloads: a fresh form, a fresh key holder. */
    const fresh = createContentBoundKey(() => `fresh${++n}`);
    const second = renderHook(() => useFormDraft('si-new', null, { name: '' }, { keys: fresh }));
    const apply = vi.fn();
    act(() => { second.result.current.restore(apply); });
    expect(apply).toHaveBeenCalledWith({ name: 'Lim' });
    expect(fresh.keyFor({ debtorName: 'Lim Mei' })).toEqual({ key: null, needsConfirm: true });
    expect(fresh.keyFor({ debtorName: 'Lim' })).toEqual({ key: 'k1', needsConfirm: false });
  });

  it('drops a draft older than seven days', () => {
    localStorage.setItem(FORM_DRAFT_PREFIX + keyOf('pv-new', 'pv'), JSON.stringify({ v: { f: { name: 'x' }, k: null }, ts: Date.now() - 8 * 24 * 3600 * 1000, version: null }));
    const { result } = renderHook(() => useFormDraft('pv-new', 'pv', { name: '' }));
    expect(result.current.offered).toBeNull();
    expect(readFormDraft(keyOf('pv-new', 'pv'))).toBeNull();
  });

  it("says when an edit form's record changed after the draft", () => {
    localStorage.setItem(FORM_DRAFT_PREFIX + keyOf('po-edit', 'po-1'), JSON.stringify({ v: { f: { qty: 2 }, k: null }, ts: Date.now(), version: 100 }));
    const { result } = renderHook(() => useFormDraft('po-edit', 'po-1', { qty: 1 }, { version: 200 }));
    expect(result.current.stale).toBe(true);
  });

  it('ignores a storage error: the form keeps working and nothing is offered', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { result, rerender } = renderHook(({ v }) => useFormDraft('so-new', null, v), { initialProps: { v: { name: '' } } });
    act(() => { vi.advanceTimersByTime(400); });
    expect(() => { rerender({ v: { name: 'x' } }); act(() => { vi.advanceTimersByTime(600); }); }).not.toThrow();
    expect(result.current.offered).toBeNull();
    spy.mockRestore(); get.mockRestore();
  });
});
