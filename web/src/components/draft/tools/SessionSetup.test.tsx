import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../../../mocks/draft/fixtures';
import { SessionSetup } from './SessionSetup';

describe('session setup', () => {
  it('marks exactly one chosen slot, and starts with it', () => {
    const onStart = vi.fn(async () => {});
    render(<SessionSetup session={null} teams={14} categories={CATEGORIES} onStart={onStart} />);
    expect(screen.getAllByRole('button', { name: /^Slot \d+$/ })).toHaveLength(14);
    fireEvent.click(screen.getByRole('button', { name: 'Slot 6' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slot 9' }));
    const pressed = screen.getAllByRole('button', { name: /^Slot \d+$/ }).filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((b) => b.getAttribute('aria-label'))).toEqual(['Slot 9']);
    expect(screen.getByText('Slot 9: you pick 9th in round 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(onStart).toHaveBeenCalledWith(9, [], undefined);
  });

  it('starts a practice draft sized for the mock room, never the real one', () => {
    const onStart = vi.fn(async () => {});
    render(<SessionSetup session={null} teams={14} categories={CATEGORIES} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: /Practice/ }));
    expect(screen.getAllByRole('button', { name: /^Slot \d+$/ })).toHaveLength(12);   // a 12-team room by default
    fireEvent.click(screen.getByRole('button', { name: '10 teams' }));
    expect(screen.getAllByRole('button', { name: /^Slot \d+$/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Slot 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start practice draft' }));
    expect(onStart).toHaveBeenCalledWith(4, [], { teams: 10, rounds: 13 });
  });
});

describe('practice ids', () => {
  it('gives each practice run its own id', async () => {
    const { practiceId, isPractice } = await import('../../../api/useDraftRoom');
    expect(practiceId(new Date(2026, 9, 15, 21, 43))).toBe('practice-1015-2143');
    expect(isPractice('practice-1015-2143')).toBe(true);
    expect(isPractice('hoopdreams-2026')).toBe(false);
  });
});
