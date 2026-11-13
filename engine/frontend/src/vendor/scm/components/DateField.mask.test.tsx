/* The date mask (owner 2026-09-06: 日期我输入是我希望不用自己打 "/"; day-first
   DD/MM/YYYY since YH, 11 Nov 2026). Pinned: digits typed straight through wear
   the mask as they land and reach the parent as ISO once complete; focus selects
   the pre-filled date so typing replaces it; the operator's own separators around
   an unpadded day/month survive (they are not the mask's slots). */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DateField, maskDmy, parseDmy } from './DateField';

describe('maskDmy (day-first)', () => {
  test('grows the separators with the digits and stops at eight', () => {
    expect(maskDmy('')).toBe('');
    expect(maskDmy('3')).toBe('3');
    expect(maskDmy('31')).toBe('31');
    expect(maskDmy('310')).toBe('31/0');
    expect(maskDmy('3103')).toBe('31/03');
    expect(maskDmy('31032')).toBe('31/03/2');
    expect(maskDmy('31032026')).toBe('31/03/2026');
    expect(maskDmy('3103202699')).toBe('31/03/2026');
  });
});

describe('DateField typing', () => {
  test('digits wear the mask as they land and reach the parent as ISO when complete', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Invoice date" />);
    const box = screen.getByLabelText('Invoice date') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '3103' } });
    expect(box.value).toBe('31/03');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '31/032026' } });
    expect(box.value).toBe('31/03/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-03-31');
  });

  test('focus selects a pre-filled date so typing replaces it', () => {
    render(<DateField value="2026-09-06" onChange={() => {}} aria-label="Invoice date" />);
    const box = screen.getByLabelText('Invoice date') as HTMLInputElement;
    fireEvent.focus(box);
    expect(box.value).toBe('06/09/2026');
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
  });

  test('parses day-first with 1-2 digit day/month and rejects a bad month', () => {
    expect(parseDmy('31/03/2026')).toBe('2026-03-31');
    expect(parseDmy('31032026')).toBe('2026-03-31');
    expect(parseDmy('1/3/2026')).toBe('2026-03-01');
    expect(parseDmy('01/13/2026')).toBeNull();
    expect(parseDmy('31/03/')).toBeNull();
  });

  test('03/04/2026 is 3 April, never 4 March', () => {
    expect(parseDmy('03/04/2026')).toBe('2026-04-03');
    expect(parseDmy('03042026')).toBe('2026-04-03');
  });

  test('31/02/2026 is not a date: nothing reaches the parent and blur says so', () => {
    expect(parseDmy('31/02/2026')).toBeNull();
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Invoice date" />);
    const box = screen.getByLabelText('Invoice date') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '31022026' } });
    expect(box.value).toBe('31/02/2026');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });

  test.each([
    ['03/04/2026', '03/04/2026', '2026-04-03'],
    ['3/4/2026', '3/4/2026', '2026-04-03'],
    ['03-04-2026', '03-04-2026', '2026-04-03'],
    // An older year-first paste is unambiguous with the year in front.
    ['2026/04/03', '2026/04/03', '2026-04-03'],
    ['2026-04-03', '2026-04-03', '2026-04-03'],
  ])('a pasted %s reaches the parent as ISO', (pasted, shown, iso) => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Invoice date" />);
    const box = screen.getByLabelText('Invoice date') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: pasted } });
    expect(box.value).toBe(shown);
    expect(onChange).toHaveBeenLastCalledWith(iso);
  });
});

/* ONE CHARACTER AT A TIME — the shape whole-string tests could not see.
   Every case here fires a change event per keystroke, the way a keyboard does,
   so an unpadded day/month whose separators are the operator's own (`7/9/2026`)
   is exercised rather than the padded form that re-lands on the mask's slots. */
describe('DateField typed one keystroke at a time', () => {
  const typeOut = (box: HTMLInputElement, text: string) => {
    for (const ch of text) fireEvent.change(box, { target: { value: box.value + ch } });
  };

  const typedResult = (text: string) => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Invoice date" />);
    const box = screen.getByLabelText('Invoice date') as HTMLInputElement;
    fireEvent.focus(box);
    typeOut(box, text);
    return { box, onChange };
  };

  test.each([
    ['7/9/2026', '2026-09-07'],
    ['1/1/2026', '2026-01-01'],
    ['7-9-2026', '2026-09-07'],
    ['31/3/2026', '2026-03-31'],
  ])('the operator keeps his own separators: %s reaches the parent as %s', (typed, iso) => {
    const { box, onChange } = typedResult(typed);
    expect(box.value).toBe(typed);
    expect(onChange).toHaveBeenLastCalledWith(iso);
  });

  test.each([
    ['07092026', '07/09/2026', '2026-09-07'],
    ['31032026', '31/03/2026', '2026-03-31'],
    ['07/09/2026', '07/09/2026', '2026-09-07'],
    ['31/03/2026', '31/03/2026', '2026-03-31'],
  ])('regression cover — the padded forms still wear the mask: %s', (typed, shown, iso) => {
    const { box, onChange } = typedResult(typed);
    expect(box.value).toBe(shown);
    expect(onChange).toHaveBeenLastCalledWith(iso);
  });

  test('a half-typed date commits nothing and is reported on blur, not swallowed', () => {
    const { box, onChange } = typedResult('7/9');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(box.value).toBe('7/9');
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });
});
