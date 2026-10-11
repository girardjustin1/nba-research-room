import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_POSITIONS_PASTE, sampleSavePositions, yahooPositionsNone } from '../../../mocks/draft/yahooPositions';
import { YahooPositionsEditor } from './YahooPositionsEditor';

describe('Yahoo positions', () => {
  it('adds the pasted positions and says how many', async () => {
    const onSave = vi.fn(async (text: string) => sampleSavePositions(yahooPositionsNone, text));
    render(<YahooPositionsEditor open onClose={() => {}} load={async () => yahooPositionsNone} onSave={onSave} />);
    await waitFor(() => expect(screen.getByText(/No Yahoo positions yet/)).toBeTruthy());
    const add = screen.getByRole('button', { name: 'Add positions' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Yahoo's Players page"), { target: { value: SAMPLE_POSITIONS_PASTE } });
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByText(/Positions for 4 players added \(4 in all\)/)).toBeTruthy());
    expect(onSave).toHaveBeenCalledWith(SAMPLE_POSITIONS_PASTE);
    expect(screen.getByText(/twin name/)).toBeTruthy();
    expect(screen.getByText(/Yahoo positions for 4 players so far/)).toBeTruthy();
  });

  it('shows why a paste was refused', async () => {
    render(<YahooPositionsEditor open onClose={() => {}} load={async () => yahooPositionsNone}
      onSave={async (t) => sampleSavePositions(yahooPositionsNone, t)} />);
    fireEvent.change(screen.getByLabelText("Yahoo's Players page"), { target: { value: 'just names' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add positions' }));
    await waitFor(() => expect(screen.getByText(/no Yahoo positions found/)).toBeTruthy());
  });
});
