import type { Meta, StoryObj } from '@storybook/react-vite';
import { resultsEmpty, resultsNormal, resultsPlayoff, resultsPunt, resultsStale } from '../../mocks/results/results';
import { PredictionReview } from './PredictionReview';

/** Predicted vs actual, and followed recommendations with their realized effect. Invented data. */
const meta = {
  title: 'Results Analysis/Prediction review',
  component: PredictionReview,
  args: { results: resultsNormal },
} satisfies Meta<typeof PredictionReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const PlayoffWeek: Story = { args: { results: resultsPlayoff } };
export const PuntBuild: Story = { args: { results: resultsPunt } };
export const StaleData: Story = { args: { results: resultsStale } };
export const NothingYet: Story = { args: { results: resultsEmpty } };
export const Loading: Story = { args: { results: null, loading: true } };
export const ApiError: Story = { args: { results: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
