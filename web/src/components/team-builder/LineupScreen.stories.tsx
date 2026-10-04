import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  lineupInfeasible,
  lineupInjury,
  lineupLastDay,
  lineupNormal,
  lineupOptimal,
  lineupPlayoff,
  lineupPunt,
  lineupStale,
} from '../../mocks/team-builder/lineup';
import { LineupScreen } from './LineupScreen';

/** Today's current vs optimal lineup, then the rest of the week. Invented data. */
const meta = {
  title: 'Team Builder/Lineup',
  component: LineupScreen,
  args: { lineup: lineupNormal, onOpenPlayer: () => {} },
} satisfies Meta<typeof LineupScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const Loading: Story = { args: { lineup: null, loading: true } };
export const ApiError: Story = { args: { lineup: null, error: 'Request failed (HTTP 502)', onRetry: () => {} } };
export const StaleData: Story = { args: { lineup: lineupStale } };
export const InjuryBreakingNews: Story = { args: { lineup: lineupInjury } };
export const LastDayOfWeek: Story = { args: { lineup: lineupLastDay } };
export const PlayoffWeek: Story = { args: { lineup: lineupPlayoff } };
export const PuntBuild: Story = { args: { lineup: lineupPunt } };
/** Empty: nothing to change. */
export const AlreadyOptimal: Story = { args: { lineup: lineupOptimal } };
/** Tapped a changed cell in the rest-of-week grid. */
export const GridCellSheetOpen: Story = { args: { openFirstChange: true } };
/** 409 from the engine (the real API today, before the first roster.csv): next step shown. */
export const NotReadyNoRoster: Story = {
  args: { lineup: null, notReady: 'No Yahoo roster yet: save roster.csv to data/inbox and run `make inbox`.', onRetry: () => {} },
};
export const NotReadyNoProjections: Story = { args: { lineup: null, notReady: 'No projections yet: run `make nightly`.', onRetry: () => {} } };
/** The API went away after a good load: last data stays with a banner. */
export const ApiDownWithLastData: Story = { args: { connectionDown: true } };
/** Phase 1 server: every delta_p_win is null and the optimizer explains its objective. */
export const Phase1NoWinDeltas: Story = {
  args: {
    lineup: {
      ...lineupNormal,
      optimizer: { ...lineupNormal.optimizer, message: 'Phase 1: maximises category-weighted projected value per day; the P(win week) objective arrives with the weekly optimizer (Phase 2).' },
      days: lineupNormal.days.map((d) => ({ ...d, delta_p_win: null, slots: d.slots.map((x) => ({ ...x, delta_p_win: null })) })),
    },
  },
};
export const OptimizerInfeasible: Story = { args: { lineup: lineupInfeasible } };
