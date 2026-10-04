import type { Meta, StoryObj } from '@storybook/react-vite';
import { CATEGORIES, makeCompare } from '../../../mocks/draft/fixtures';
import { SAMPLE_PLAYERS } from '../../../mocks/draft/players';
import { notFound } from '../../../mocks/draft/room';
import type { ComparePlayer } from '../../../api/types';
import { CompareView } from './CompareView';

const ids = [SAMPLE_PLAYERS[10]!.player_id, SAMPLE_PLAYERS[12]!.player_id, SAMPLE_PLAYERS[14]!.player_id];

const meta = {
  title: 'Draft/Compare/Compare View',
  component: CompareView,
  args: {
    open: true,
    ids,
    categories: CATEGORIES,
    load: async (i: number[]) => makeCompare(i),
    fallback: SAMPLE_PLAYERS.filter((p) => ids.includes(p.player_id)).map((p) => ({ ...p }) as ComparePlayer),
    onClose: () => {},
  },
} satisfies Meta<typeof CompareView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePlayers: Story = {};
export const TwoPlayers: Story = { args: { ids: ids.slice(0, 2) } };
/** GET /draft/compare missing: falls back to what the board already knows. */
export const EndpointMissing: Story = {
  args: {
    load: async () => {
      throw notFound;
    },
  },
};
