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
    expect(onStart).toHaveBeenCalledWith(9, []);
  });
});
