import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makePool, makeSession } from '../../../mocks/draft/fixtures';
import { mockRoomState } from '../../../mocks/draft/room';
import { renderWithTheme } from '../../../test/render';
import { AssignPickSheet } from './AssignPickSheet';
import { AvailableList } from '../sheet/AvailableList';
import { DraftBoardGrid } from './DraftBoardGrid';

const session = makeSession({ mySlot: 5, currentPick: 30 });
const pool = mockRoomState(session, null).pool;

describe('DraftBoardGrid', () => {
  it('reports the pick number and snake column of a tapped empty cell', () => {
    const onCellTap = vi.fn();
    renderWithTheme(<DraftBoardGrid session={session} pool={pool} onCellTap={onCellTap} />);
    fireEvent.click(screen.getByRole('gridcell', { name: /^3\.02, pick 30,/ }));
    expect(onCellTap).toHaveBeenCalledWith(expect.objectContaining({ pickNo: 30, round: 3, slot: 2, made: null }));
  });
  it('shows a made pick with its player and offers change/remove', () => {
    const onCellTap = vi.fn();
    renderWithTheme(<DraftBoardGrid session={session} pool={pool} onCellTap={onCellTap} />);
    const first = session.picks[0]!;
    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`^1\\.01, .*${first.player_name}`) }));
    expect(onCellTap.mock.calls[0]![0].made.player_name).toBe(first.player_name);
  });
});

describe('AvailableList', () => {
  it('puts the PROJ. PICK divider at my next pick in ADP order', () => {
    renderWithTheme(
      <AvailableList
        players={makePool(session)}
        teams={14}
        currentPick={30}
        onTheClockLabel="Fictional Five"
        mineOnTheClock={false}
        myNextPick={33}
        favorites={new Set()}
        onToggleFavorite={() => {}}
        compare={[]}
        onToggleCompare={() => {}}
        onOpenCompare={() => {}}
        onDraft={() => {}}
      />,
    );
    expect(screen.getByRole('separator')).toHaveTextContent('PROJ. PICK: 3.05 (33 OVR)');
  });
});

describe('AssignPickSheet', () => {
  it('assigns the chosen player to the cell pick for the cell team', async () => {
    const onAssign = vi.fn(async () => {});
    const players = makePool(session);
    renderWithTheme(
      <AssignPickSheet
        cell={{ pickNo: 41, round: 3, slot: 13, made: null }}
        session={session}
        players={players}
        pool={pool}
        onClose={() => {}}
        onAssign={onAssign}
        onChange={async () => {}}
        onRemove={async () => {}}
      />,
    );
    const target = players.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(target.name) }));
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith(41, 13, target.player_id));
  });
});

describe('AvailableList playoff sort', () => {
  it('sorts by fantasy playoff games, most first', () => {
    const players = makePool(session).slice(0, 12);
    renderWithTheme(
      <AvailableList
        players={players}
        teams={14}
        currentPick={30}
        onTheClockLabel="Fictional Five"
        mineOnTheClock={false}
        myNextPick={33}
        favorites={new Set()}
        onToggleFavorite={() => {}}
        compare={[]}
        onToggleCompare={() => {}}
        onOpenCompare={() => {}}
        onDraft={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Playoff games' }));
    const names = screen.getAllByRole('button', { name: /: details$/ }).map((b) => b.getAttribute('aria-label')!.replace(': details', ''));
    const games = names.map((n) => players.find((p) => p.name === n)!.playoff_games ?? -1);
    expect(games).toEqual([...games].sort((a, b) => b - a));
  });
});
