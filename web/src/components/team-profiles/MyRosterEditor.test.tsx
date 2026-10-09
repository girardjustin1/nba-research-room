import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MyRosterRequest } from '../../api/season';
import { myRosterEmpty, myRosterFilled, sampleSaveMine, sampleSearchMine } from '../../mocks/team-profiles/myRoster';
import { renderWithTheme } from '../../test/render';
import { MyRosterEditor } from './MyRosterEditor';

describe('my roster', () => {
  it('adds players, marks one on the IL, removes one and saves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (b: MyRosterRequest) => sampleSaveMine(myRosterEmpty, b));
    renderWithTheme(<MyRosterEditor data={myRosterEmpty} onSearch={async (q) => sampleSearchMine(q)} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    for (const [typed, pick] of [['ashg', /Rennick Ashgrove/], ['thorn', /Marcus Thornbury/], ['kett', /Tobias Kettering/]] as const) {
      await user.type(screen.getByRole('combobox', { name: 'Add a player' }), typed);
      await user.click(await screen.findByRole('option', { name: pick }));
    }
    await user.click(screen.getByRole('button', { name: 'Marcus Thornbury on IL' }));
    await user.click(screen.getByRole('button', { name: 'Remove Tobias Kettering' }));
    expect(screen.getByText(/2 of 14 players · 1 on IL/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0]).toEqual({ player_ids: [100, 113], names: [], il_ids: [113] });
    expect(await screen.findByText(/^Saved /)).toBeInTheDocument();
  });

  it('refuses more players than the roster holds', () => {
    const big = { ...myRosterFilled, max_players: 3 };
    renderWithTheme(<MyRosterEditor data={big} onSearch={async () => []} onSave={async () => big} />);
    expect(screen.getByText(/A roster holds at most 3 players/)).toBeInTheDocument();
  });
});
