import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OpponentRosterRequest, TeamNamesRequest } from '../../api/season';
import { SEARCHABLE, opponentRosterEmpty, opponentRosterFilled, sampleSave, sampleSaveNames, sampleSearch } from '../../mocks/team-profiles/opponentRoster';
import { renderWithTheme } from '../../test/render';
import { OpponentRosterEditor } from './OpponentRosterEditor';

describe("this week's opponent", { timeout: 20_000 }, () => { // many keystrokes: slow on CI runners
  it('picks the team, adds by search, removes, pastes names and saves', async () => {
    const user = userEvent.setup();
    const saved: OpponentRosterRequest[] = [];
    const onSave = vi.fn(async (b: OpponentRosterRequest) => {
      saved.push(b);
      return sampleSave(opponentRosterEmpty, b);
    });
    renderWithTheme(<OpponentRosterEditor data={opponentRosterEmpty} onSearch={async (q) => sampleSearch(q)} onSave={onSave} onSaveNames={async (b) => sampleSaveNames(opponentRosterEmpty, b)} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: /Who are you playing/ }));
    await user.click(await screen.findByRole('option', { name: 'Team 4' }));
    await user.type(screen.getByRole('combobox', { name: 'Add a player' }), 'wex');
    await user.click(await screen.findByRole('option', { name: /Grant Wexford/ }));
    await user.type(screen.getByRole('combobox', { name: 'Add a player' }), 'quarry');
    await user.click(await screen.findByRole('option', { name: /Desmond Quarry/ }));
    expect(screen.getByText('Their players (2)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Desmond Quarry' }));
    expect(screen.getByText('Their players (1)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Paste a list of names' }));
    await user.type(screen.getByRole('textbox', { name: /Paste names/ }), 'Kellan Ashby{enter}Nobody Known');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(saved[0]).toEqual({ team_id: 4, player_ids: [200], names: ['Kellan Ashby', 'Nobody Known'] });
    expect(await screen.findByText("1 name didn't match an NBA player")).toBeInTheDocument();
    expect(screen.getByText('Their players (2)')).toBeInTheDocument();          // Wexford + Ashby
    expect(screen.getByText(/^Saved /)).toBeInTheDocument();
  });

  it('shows how the entry is kept', () => {
    renderWithTheme(<OpponentRosterEditor data={opponentRosterFilled} onSearch={async () => []} onSave={async () => opponentRosterFilled} onSaveNames={async () => opponentRosterFilled} />);
    expect(screen.getByText(/one opponent's roster at a time, replaced each week/)).toBeInTheDocument();
  });

  it('registers a team by name with the roster, and names every team at once', async () => {
    const user = userEvent.setup();
    let data = opponentRosterEmpty;
    const onSave = vi.fn(async (b: OpponentRosterRequest) => (data = sampleSave(data, b)));
    const onSaveNames = vi.fn(async (b: TeamNamesRequest) => (data = sampleSaveNames(data, b)));
    renderWithTheme(<OpponentRosterEditor data={data} onSearch={async (q) => sampleSearch(q)} onSave={onSave} onSaveNames={onSaveNames} />);
    await user.click(screen.getByRole('combobox', { name: /Who are you playing/ }));
    await user.click(await screen.findByRole('option', { name: 'Team 6' }));
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Invented Rivals');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].team_name).toBe('Invented Rivals');
    expect(screen.getByRole('combobox', { name: /Who are you playing/ })).toHaveTextContent('Invented Rivals');

    await user.click(screen.getByRole('button', { name: 'Name all teams' }));
    await user.type(await screen.findByRole('textbox', { name: 'Team 2' }), 'Second Invented');
    await user.click(screen.getByRole('button', { name: 'Save names' }));
    await waitFor(() => expect(onSaveNames).toHaveBeenCalledOnce());
    expect(onSaveNames.mock.calls[0]![0]).toEqual({ teams: [{ team_id: 2, name: 'Second Invented' }] });
  });

  it('reads a screenshot into the form for a check, without saving', async () => {
    const shot = {
      team_id: 5, team_name: 'Invented Rivals', players: SEARCHABLE.slice(0, 3).map((p) => ({ ...p, owner: 'opponent' as const })),
      skipped_mine: 2, too_many: false, ambiguous: [], policy: 'Read on this Mac.',
    };
    const onScreenshot = vi.fn<(image: string) => Promise<typeof shot>>(async () => shot);
    const onSave = vi.fn(async () => opponentRosterFilled);
    renderWithTheme(
      <OpponentRosterEditor data={{ ...opponentRosterFilled, teams: [{ team_id: 5, label: 'Invented Rivals', name: 'Invented Rivals' }] }}
        onSearch={async () => []} onSave={onSave} onSaveNames={async () => opponentRosterFilled} onScreenshot={onScreenshot} />,
    );
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'roster.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Screenshot of their roster'), file);
    expect(await screen.findByText(/Read 3 players for Invented Rivals \(left out 2 of yours\)/)).toBeInTheDocument();
    expect(onScreenshot.mock.calls[0]![0]).toMatch(/^data:image\/png;base64,/);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: `Remove ${SEARCHABLE[0]!.name}` })).toBeInTheDocument();
  });
});
