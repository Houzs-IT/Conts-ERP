// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from './shared';

describe('MoneyInput blankZero', () => {
  it('shows RM 0 as an empty box with a 0.00 placeholder', () => {
    render(<MoneyInput blankZero ariaLabel="Unit price" value={0} onChange={() => {}} />);
    const box = screen.getByLabelText('Unit price') as HTMLInputElement;
    expect(box.value).toBe('');
    expect(box.placeholder).toBe('0.00');
    expect(box.inputMode).toBe('decimal');
  });

  it('still shows a real price and saves what is typed', () => {
    const onChange = vi.fn();
    render(<MoneyInput blankZero ariaLabel="Unit price" value={12550} onChange={onChange} />);
    const box = screen.getByLabelText('Unit price') as HTMLInputElement;
    expect(box.value).toBe('125.50');
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('without blankZero a 0 still shows as 0', () => {
    render(<MoneyInput ariaLabel="Cost" value={0} onChange={() => {}} />);
    expect((screen.getByLabelText('Cost') as HTMLInputElement).value).toBe('0');
  });
});
