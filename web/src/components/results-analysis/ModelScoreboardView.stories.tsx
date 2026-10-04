import type { Meta, StoryObj } from '@storybook/react-vite';
import { SCOREBOARD, SCOREBOARD_GATED_OFF, SCOREBOARD_PRESEASON } from '../../mocks/results-analysis/scoreboard';
import { ModelScoreboardView } from './ModelScoreboardView';

/** Models vs the EWMA baseline (MAE) and calibration, from the backtest. Invented numbers. */
const meta = {
  title: 'Results Analysis/Model scoreboard',
  component: ModelScoreboardView,
  args: { scoreboard: SCOREBOARD },
} satisfies Meta<typeof ModelScoreboardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Minutes: Story = {};
export const Points: Story = { args: { initialStat: 'pts' } };
/** A stat where Ridge and CatBoost lose to EWMA. */
export const ThreesMixed: Story = { args: { initialStat: 'fg3m' } };
export const EnsembleGatedOff: Story = { args: { scoreboard: SCOREBOARD_GATED_OFF, initialStat: 'stl' } };
export const PreseasonReplay: Story = { args: { scoreboard: SCOREBOARD_PRESEASON } };
export const Loading: Story = { args: { scoreboard: null, loading: true } };
export const ApiError: Story = { args: { scoreboard: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
