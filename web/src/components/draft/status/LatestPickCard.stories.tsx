import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { makeInsights, makeSession } from '../../../mocks/draft/fixtures';
import { LatestPickCard } from './LatestPickCard';

const ins = makeInsights(makeSession({ mySlot: 5, currentPick: 30 }));
const opponent = ins.filter((i) => i.vs_me).at(-1)!;
const mine = ins.find((i) => !i.vs_me)!;

const meta = {
  title: 'Draft/Status/Latest Pick Card',
  component: LatestPickCard,
  decorators: [(Story) => <Box sx={{ p: 1, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Box>],
  args: { insight: opponent, teams: 14, onOpenTeam: () => {}, onDismiss: () => {} },
} satisfies Meta<typeof LatestPickCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpponentPick: Story = {};
/** My own pick: no head-to-head line. */
export const MyPick: Story = { args: { insight: mine } };
