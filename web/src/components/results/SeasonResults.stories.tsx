import type { Meta, StoryObj } from '@storybook/react-vite';
import { resultsEmpty, resultsNormal, resultsPlayoff, resultsPunt, resultsStale } from '../../mocks/results/results';
import { SeasonResults } from './SeasonResults';

/** Past weeks, category results, record and standings. Invented data. */
const meta = {
  title: 'Results/Season',
  component: SeasonResults,
  args: { results: resultsNormal },
} satisfies Meta<typeof SeasonResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const CategorySheetOpen: Story = { args: { initialOpen: { week: 3, key: 'pts' } } };
export const PlayoffWeek: Story = { args: { results: resultsPlayoff } };
export const PuntBuild: Story = { args: { results: resultsPunt } };
export const StaleData: Story = { args: { results: resultsStale } };
/** Empty: before week 1 is complete. */
export const NoWeeksYet: Story = { args: { results: resultsEmpty } };
export const Loading: Story = { args: { results: null, loading: true } };
export const ApiError: Story = { args: { results: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
