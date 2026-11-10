// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readDraft, useRenovationDraft, writeDraft } from './renovationFormDraft';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useRenovationDraft', () => {
  it('saves a dirty form half a second after the last change', () => {
    const { rerender } = renderHook(({ v, dirty }) => useRenovationDraft('vo:1', v, dirty, 3), { initialProps: { v: { title: 'a' }, dirty: false } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readDraft('vo:1')).toBeNull();
    rerender({ v: { title: 'ab' }, dirty: true });
    act(() => { vi.advanceTimersByTime(400); });
    expect(readDraft('vo:1')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(readDraft<{ title: string }>('vo:1')?.v.title).toBe('ab');
    expect(readDraft('vo:1')?.version).toBe(3);
  });

  it('offers an earlier draft and does not overwrite it before an answer', () => {
    writeDraft('vo:1', { title: 'old' }, 3);
    const { result, rerender } = renderHook(({ v, dirty }) => useRenovationDraft('vo:1', v, dirty, 3), { initialProps: { v: { title: '' }, dirty: false } });
    expect(result.current.offered?.v).toEqual({ title: 'old' });
    expect(result.current.stale).toBe(false);
    rerender({ v: { title: 'new typing' }, dirty: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readDraft<{ title: string }>('vo:1')?.v.title).toBe('old');
    act(() => { result.current.answer(true); });
    expect(result.current.offered).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readDraft<{ title: string }>('vo:1')?.v.title).toBe('new typing');
  });

  it('discard and save both remove the draft', () => {
    writeDraft('vo:1', { title: 'old' }, 3);
    const { result } = renderHook(() => useRenovationDraft('vo:1', { title: '' }, false, 3));
    act(() => { result.current.answer(false); });
    expect(readDraft('vo:1')).toBeNull();
    writeDraft('vo:2', { title: 'x' }, 1);
    const second = renderHook(() => useRenovationDraft('vo:2', { title: 'x' }, true, 1));
    act(() => { second.result.current.clear(); });
    expect(readDraft('vo:2')).toBeNull();
  });

  it('says when the record was saved again after the draft', () => {
    writeDraft('quotation:5:1', { title: 'old' }, 2);
    const { result } = renderHook(() => useRenovationDraft('quotation:5:1', { title: '' }, false, 4));
    expect(result.current.stale).toBe(true);
  });

  it('reads and writes nothing when the form is not editable', () => {
    writeDraft('vo:1', { title: 'old' }, 3);
    const { result } = renderHook(() => useRenovationDraft(null, { title: 'x' }, true, 3));
    expect(result.current.offered).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(readDraft<{ title: string }>('vo:1')?.v.title).toBe('old');
  });

  it('drops a draft older than seven days', () => {
    writeDraft('vo:1', { title: 'old' }, 3);
    expect(readDraft('vo:1', Date.now() + 8 * 24 * 3600 * 1000)).toBeNull();
    expect(readDraft('vo:1')).toBeNull();
  });
});
