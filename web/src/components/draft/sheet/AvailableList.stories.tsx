import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import Box from '@mui/material/Box';
import { makePool, waitingSession } from '../../../mocks/draft/fixtures';
import { AvailableList, type AvailableListProps } from './AvailableList';

const players = makePool(waitingSession);

function Stateful(args: AvailableListProps) {
  const [fav, setFav] = useState(args.favorites);
  const [cmp, setCmp] = useState(args.compare);
  return (
    <AvailableList
      {...args}
      favorites={fav}
      onToggleFavorite={(id) => setFav((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      compare={cmp}
      onToggleCompare={(id) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(0, 3)))}
    />
  );
}

const meta = {
  title: 'Draft/Sheet/Available List',
  component: AvailableList,
  render: (args) => <Stateful {...args} />,
  decorators: [(Story) => <Box sx={{ pt: 'var(--sim-safe-top)', height: '100dvh', overflowY: 'auto' }}><Story /></Box>],
  args: {
    players,
    teams: 14,
    currentPick: 30,
    onTheClockLabel: 'Fictional Five',
    mineOnTheClock: false,
    myNextPick: 33,
    favorites: new Set([players[3]!.player_id]),
    onToggleFavorite: () => {},
    compare: [],
    onToggleCompare: () => {},
    onOpenCompare: () => {},
    onDraft: () => {},
  },
} satisfies Meta<typeof AvailableList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ADP order with the PROJ. PICK divider at my next pick (3.05, 33 overall). */
export const AdpSort: Story = {};
export const OnTheClock: Story = { args: { mineOnTheClock: true, onTheClockLabel: 'You', currentPick: 33 } };
/** Two checked: the Compare Players button appears. */
export const Comparing: Story = { args: { compare: [players[0]!.player_id, players[2]!.player_id] } };
export const FavoritesOnly: Story = { args: { favoritesOnly: true } };
export const NoFavorites: Story = { args: { favoritesOnly: true, favorites: new Set() } };
/** An older API without the rank fields: dashes, and the ROOKIE chip is disabled. */
export const OlderApiFields: Story = {
  args: {
    players: players.map((p) => ({ ...p, pos_rank: undefined, adp_pos_rank: undefined, rookie: undefined, playoff_games: undefined })),
  },
};
