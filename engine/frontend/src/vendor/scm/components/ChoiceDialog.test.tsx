// ChoiceDialog — the pick-one modal. What is pinned:
//   • a short list keeps its buttons, no search box (the batch download chooser and the like);
//   • a long list fits the screen (chew 10 Nov 2026: a petty cash float's keeper list ran off it as a wall of black
//     buttons): the card is capped at the screen's height, the list scrolls inside it, and a search box narrows it.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoiceDialog } from './ChoiceDialog';

const staff = Array.from({ length: 20 }, (_, i) => ({ value: `u${i}`, label: `Person ${i}`, detail: i % 2 ? 'Management' : 'Maintenance' }));

describe('ChoiceDialog', () => {
  it('a short list keeps its buttons and has no search box', () => {
    render(<ChoiceDialog title="Download 5 documents" onPick={vi.fn()} onCancel={vi.fn()}
      options={[{ value: 'one', label: 'One combined PDF' }, { value: 'many', label: 'Separate files' }]} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'One combined PDF' })).toBeTruthy();
  });

  it('a long list fits the screen: the card is capped, the list scrolls inside it, and a search narrows it', () => {
    const onPick = vi.fn();
    render(<ChoiceDialog title="Who keeps the cash?" options={staff} onPick={onPick} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Who keeps the cash?' }).style.maxHeight).toContain('100vh');
    expect(screen.getByRole('list').style.overflowY).toBe('auto');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the list' }), { target: { value: 'person 13' } });
    expect(screen.queryByText('Person 12')).toBeNull();
    fireEvent.click(screen.getByText('Person 13'));
    expect(onPick).toHaveBeenCalledWith('u13');
  });

  it('the search also reads the detail line; Enter picks the only match', () => {
    const onPick = vi.fn();
    render(<ChoiceDialog title="Who keeps the cash?" onPick={onPick} onCancel={vi.fn()}
      options={[...staff, { value: 'f', label: 'FONG', detail: 'Finance' }]} />);
    const search = screen.getByRole('searchbox', { name: 'Search the list' });
    fireEvent.change(search, { target: { value: 'finance' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('f');
  });

  it('says so when nothing matches', () => {
    render(<ChoiceDialog title="Who keeps the cash?" options={staff} onPick={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the list' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});
