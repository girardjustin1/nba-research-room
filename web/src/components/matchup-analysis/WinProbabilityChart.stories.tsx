import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import {
  probCollapse,
  probComeback,
  probComfortable,
  probCompare,
  probEmpty,
  probFinal,
  probLastDay,
  probMonday,
  probNormal,
} from '../../mocks/matchup-analysis/probability';
import { WinProbabilityChart } from './WinProbabilityChart';

/** P(win week) over the week: actual, do nothing, with moves. Invented snapshots. */
const meta = {
  title: 'Matchup Analysis/Win probability',
  component: WinProbabilityChart,
  decorators: [
    (Story) => (
      <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}>
        <Story />
      </Card>
    ),
  ],
  args: { data: probNormal },
} satisfies Meta<typeof WinProbabilityChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Lead changes Mon–Wed; do nothing vs the recommended plan. */
export const NormalWeek: Story = {};
export const ComfortableWin: Story = { args: { data: probComfortable } };
export const Comeback: Story = { args: { data: probComeback } };
export const CollapseAfterInjuryNews: Story = { args: { data: probCollapse } };
export const MondayOnePoint: Story = { args: { data: probMonday } };
export const LastDay: Story = { args: { data: probLastDay } };
export const FinalResult: Story = { args: { data: probFinal } };
export const ComparePlans: Story = { args: { data: probCompare, initialView: 'compare' } };
export const TableView: Story = { args: { initialView: 'table' } };
export const PointSheetOpen: Story = { args: { openTs: probNormal.history[5]!.ts, onOpenTs: () => {} } };
export const ProjectedSheetOpen: Story = { args: { openTs: probNormal.scenarios[0]!.points[2]!.ts, onOpenTs: () => {} } };
export const Recomputing: Story = { args: { recomputing: true } };
export const NoDataYet: Story = { args: { data: probEmpty } };
export const Dark: Story = { globals: { colorMode: 'dark' } };
