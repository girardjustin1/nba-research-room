import type { Meta, StoryObj } from '@storybook/react-vite';
import { LAST_DAY, SEASON_CATEGORIES, TODAY } from '../../mocks/foundations/seasonCommon';
import {
  movesInfeasible,
  movesInjury,
  movesLastDay,
  movesNoAcquisitions,
  movesNone,
  movesNormal,
  movesPlayoff,
  movesPunt,
  movesStale,
} from '../../mocks/team-builder/moves';
import { MovesScreen } from './MovesScreen';

/** Ranked ADD/DROP, START, BENCH moves with the do-nothing baseline. Invented data. */
const meta = {
  title: 'Team Builder/Moves planner',
  component: MovesScreen,
  args: { moves: movesNormal, today: TODAY, categories: SEASON_CATEGORIES, opponentName: 'Pick & Roll Call', onOpenPlayer: () => {}, onCompare: () => {} },
} satisfies Meta<typeof MovesScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const Loading: Story = { args: { moves: null, loading: true } };
export const ApiError: Story = { args: { moves: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
export const StaleData: Story = { args: { moves: movesStale } };
export const InjuryBreakingNews: Story = { args: { moves: movesInjury } };
export const LastDayOfWeek: Story = { args: { moves: movesLastDay, today: LAST_DAY } };
export const PlayoffWeek: Story = { args: { moves: movesPlayoff, today: '2027-03-17', opponentName: 'Backdoor Cutters' } };
export const PuntBuild: Story = { args: { moves: movesPunt } };
export const NoAcquisitionsLeft: Story = { args: { moves: movesNoAcquisitions } };
/** Empty: doing nothing is best. */
export const DoNothingIsBest: Story = { args: { moves: movesNone } };
export const OptimizerInfeasible: Story = { args: { moves: movesInfeasible } };
