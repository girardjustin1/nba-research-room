import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { completeSession, driftSession, makeSession, makeTeams, onTheClockSession } from '../../../mocks/draft/fixtures';
import { mockRoomState } from '../../../mocks/draft/room';
import type { TeamMeta } from './DraftBoardGrid';
import { DraftBoardGrid } from './DraftBoardGrid';

const pool = mockRoomState(driftSession, null).pool;
const meta2 = new Map<number, TeamMeta>(makeTeams(driftSession).map((t) => [t.team_id, { needs: t.open_slots.filter((s) => s !== 'Util').slice(0, 3), weakest: 'FT%' }]));

const meta = {
  title: 'Draft/Grid/Draft Board Grid',
  component: DraftBoardGrid,
  decorators: [(Story) => <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', pt: 'var(--sim-safe-top)' }}><Story /></Box>],
  args: { session: driftSession, pool, onCellTap: () => {}, onEditNames: () => {}, teamMeta: meta2 },
} satisfies Meta<typeof DraftBoardGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Round 5: made picks by position group, my column highlighted, current pick outlined. */
export const MidDraft: Story = {};
export const FirstPick: Story = { args: { session: onTheClockSession, teamMeta: undefined } };
/** Picks entered out of order while catching up: gaps stay tappable. */
export const OutOfOrder: Story = {
  args: { session: { ...makeSession({ currentPick: 20 }), picks: makeSession({ currentPick: 20 }).picks.filter((p) => p.pick_no % 4 !== 0) } },
};
export const Complete: Story = { args: { session: completeSession } };
