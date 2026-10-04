import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { ACQ_NORMAL } from '../../mocks/matchup-analysis/week';
import { MOVE_ADD_BRAMWELL, MOVE_ADD_NORTHCOTT } from '../../mocks/team-builder/moves';
import { waiversLastDay, waiversNormal } from '../../mocks/team-builder/waivers';
import { PlayableStrip } from './PlayableStrip';

/** A pickup's week vs my open slots, with the paired drop. Invented data. */
const meta = {
  title: 'Team Builder/Playable games strip',
  component: PlayableStrip,
  decorators: [
    (Story) => (
      <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}>
        <Story />
      </Card>
    ),
  ],
  args: { playable: MOVE_ADD_BRAMWELL.playable!, addName: 'Callum Bramwell', dropName: 'Bram Venhaus', acquisitions: ACQ_NORMAL },
} satisfies Meta<typeof PlayableStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddsPlayableGames: Story = {};
/** Raw games up but playable games flat: Friday's slots are full. */
export const SlotsFullNoGain: Story = { args: { playable: waiversNormal.candidates[2]!.playable, addName: 'Ravi Hargreave', dropName: 'Theo Talbridge' } };
export const WaiverClaim: Story = { args: { playable: MOVE_ADD_NORTHCOTT.playable!, addName: 'Nico Northcott', dropName: 'Theo Talbridge' } };
export const LastDayNoDrop: Story = { args: { playable: waiversLastDay.candidates[0]!.playable, addName: 'Ravi Hargreave', dropName: null } };
export const SheetOpen: Story = { args: { initialOpen: { row: 'add', i: 3 } } };
export const DropSheetOpen: Story = { args: { initialOpen: { row: 'drop', i: 6 } } };
export const OneAcquisitionLeft: Story = { args: { acquisitions: { ...ACQ_NORMAL, used: 3 } } };
