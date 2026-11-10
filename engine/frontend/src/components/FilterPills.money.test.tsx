// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterPills, pillMoney } from './FilterPills';

describe('FilterPills money (TODO item 5)', () => {
  it('shows the count and whole-ringgit money; no money for 0 or when left out', () => {
    render(<FilterPills value="draft" onChange={() => {}} options={[
      { value: 'draft', label: 'Draft', count: 25, moneySen: 1563140 },
      { value: 'open', label: 'Submitted', count: 3, moneySen: 0 },
      { value: 'cancelled', label: 'Cancelled', count: 2 },
    ]} />);
    expect(screen.getByRole('button', { name: /Draft/ }).textContent).toBe('Draft25· RM 15,631');
    expect(screen.getByRole('button', { name: /Submitted/ }).textContent).toBe('Submitted3');
    expect(screen.getByRole('button', { name: /Cancelled/ }).textContent).toBe('Cancelled2');
  });
  it('rounds to whole ringgit', () => {
    expect(pillMoney(1563150)).toBe('RM 15,632');
    expect(pillMoney(99)).toBe('RM 1');
  });
});
