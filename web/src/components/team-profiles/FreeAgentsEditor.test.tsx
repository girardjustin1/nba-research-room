import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_PASTE, freeAgentsEmpty, freeAgentsStale, sampleSaveFree } from '../../mocks/team-profiles/freeAgents';
import { FreeAgentsEditor } from './FreeAgentsEditor';

describe('free agents', { timeout: 20_000 }, () => { // many keystrokes: slow on CI runners
  it('saves the pasted text and shows the players found', async () => {
    const onSave = vi.fn(async (b: { text: string }) => sampleSaveFree(b));
    render(<FreeAgentsEditor data={freeAgentsEmpty} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Save list' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Yahoo's Players page"), { target: { value: SAMPLE_PASTE } });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText('Found (5)')).toBeTruthy());
    expect(onSave).toHaveBeenCalledWith({ text: SAMPLE_PASTE });
    expect((screen.getByLabelText("Yahoo's Players page") as HTMLTextAreaElement).value).toBe('');
  });

  it('says when nothing was found, and when the list is old', async () => {
    render(<FreeAgentsEditor data={freeAgentsStale} onSave={async (b) => sampleSaveFree(b)} />);
    expect(screen.getByText(/other teams have added and dropped since/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Yahoo's Players page"), { target: { value: 'nothing here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));
    await waitFor(() => expect(screen.getByText(/no NBA player names found/)).toBeTruthy());
  });
});
