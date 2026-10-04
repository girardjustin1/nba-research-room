import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { CATEGORIES, driftBoard, makeMyTeam, onTheClockSession, puntBoard } from '../../../mocks/draft/fixtures';
import { MyTeamPanel } from './MyTeamPanel';

const meta = {
  title: 'Draft/Sheet/My Team Panel',
  component: MyTeamPanel,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default' }}><Story /></Box>],
  args: { myTeam: driftBoard.my_team, categories: CATEGORIES, punts: [], rounds: 13, onPuntsChange: () => {} },
} satisfies Meta<typeof MyTeamPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidDraft: Story = {};
/** Before my first pick: every category is a coin flip and every slot is open. */
export const Empty: Story = { args: { myTeam: makeMyTeam(onTheClockSession) } };
export const PuntingFT: Story = { args: { myTeam: puntBoard.my_team, punts: ['ft_pct'] } };
export const PuntsSaving: Story = { args: { punts: ['ft_pct'], puntsBusy: true } };
/** The engine returned no estimate for two categories: shown as dashes plus a note. */
export const MissingEstimates: Story = {
  args: { myTeam: { ...driftBoard.my_team, p_cat: { ...driftBoard.my_team.p_cat, stl: null, blk: null }, p_win_week: null } },
};
