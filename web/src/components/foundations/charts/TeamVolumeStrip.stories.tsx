import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { makeTeamDays, makeTeamWeeks } from '../../../mocks/draft/fixtures';
import { notFound } from '../../../mocks/draft/room';
import { TeamVolumeStrip } from './TeamVolumeStrip';

const schedule = makeTeamWeeks();
const loadDays = async (team: string) => {
  await new Promise((r) => setTimeout(r, 200));
  return makeTeamDays(team);
};

const meta = {
  title: 'Foundations/Charts/Team Volume Strip',
  component: TeamVolumeStrip,
  decorators: [(Story) => <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}><Story /></Card>],
  args: { teamAbbr: 'DEN', schedule, loadDays },
} satisfies Meta<typeof TeamVolumeStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Invented counts on real team codes. Playoff weeks 20-22 in blue; weeks 1* and 17* span 14 days. */
export const Default: Story = {};
/** A Basketball Monster code (NOR) joins to the schedule's NOP. */
export const BbmTeamCode: Story = { args: { teamAbbr: 'NOR' } };
export const NoMonthTotals: Story = { args: { loadDays: undefined } };
export const UnknownTeam: Story = { args: { teamAbbr: 'FA' } };
export const Loading: Story = { args: { schedule: null } };
export const EndpointMissing: Story = { args: { schedule: null, scheduleError: notFound } };
