import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  gcComfortable,
  gcDeficitWithPlan,
  gcEarlyWeek,
  gcEmpty,
  gcFinalLoss,
  gcFinalWin,
  gcInjuryHeavy,
  gcLastDay,
  gcMidweekClose,
} from '../../mocks/matchup-analysis/gamecenter';
import { probCollapse, probComfortable, probDeficit, probEmpty, probFinal, probFinalLoss, probLastDay, probMonday, probNormal } from '../../mocks/matchup-analysis/probability';
import { GameCenter } from './GameCenter';

/** The matchup as a live game page. Invented data. */
const meta = {
  title: 'Matchup Analysis/Game Center',
  component: GameCenter,
  args: { gc: gcMidweekClose, probability: probNormal, onOpenPlayer: () => {} },
} satisfies Meta<typeof GameCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidweekClose: Story = {};
/** [With moves] with the BLK path selected. */
export const WithMovesByCategory: Story = { args: { initialChart: 'moves', initialMetric: 'blk' } };
export const WithMovesWeek: Story = { args: { initialChart: 'moves' } };
export const EarlyWeek: Story = { args: { gc: gcEarlyWeek, probability: probMonday } };
export const MidweekDeficitWithPlan: Story = { args: { gc: gcDeficitWithPlan, probability: probDeficit, initialChart: 'moves' } };
export const ComfortableLead: Story = { args: { gc: gcComfortable, probability: probComfortable } };
export const InjuryHeavyWeek: Story = { args: { gc: gcInjuryHeavy, probability: probCollapse } };
export const LastDay: Story = { args: { gc: gcLastDay, probability: probLastDay } };
export const FinalWin: Story = { args: { gc: gcFinalWin, probability: probFinal } };
export const FinalLoss: Story = { args: { gc: gcFinalLoss, probability: probFinalLoss } };
export const Empty: Story = { args: { gc: gcEmpty, probability: probEmpty } };
export const NoProbabilityEndpoint: Story = { args: { probability: undefined } };
export const Loading: Story = { args: { gc: null, probability: null, loading: true } };
export const ApiError: Story = { args: { gc: null, probability: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
export const Dark: Story = { globals: { colorMode: 'dark' } };
