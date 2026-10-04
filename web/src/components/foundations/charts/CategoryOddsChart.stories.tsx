import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { CATEGORIES, SAMPLE_P_CAT } from '../../../mocks/draft/fixtures';
import { CategoryOddsChart } from './CategoryOddsChart';

const meta = {
  title: 'Foundations/Charts/Category Odds Chart',
  component: CategoryOddsChart,
  decorators: [(Story) => <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}><Story /></Card>],
  args: { pCat: SAMPLE_P_CAT, categories: CATEGORIES, punts: [] },
} satisfies Meta<typeof CategoryOddsChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Blue = favored, red = behind, gray = within 2 points of 50%. Tap a bar for its readout. */
export const Default: Story = {};
/** Punted categories render gray and are labelled "(punt)". */
export const WithPunts: Story = { args: { punts: ['ft_pct', 'tov'] } };
export const TableView: Story = { args: { initialView: 'table' } };
export const AllEven: Story = { args: { pCat: Object.fromEntries(CATEGORIES.map((c) => [c.key, 0.5])) } };
export const Extremes: Story = {
  args: { pCat: { ...SAMPLE_P_CAT, fg_pct: 0.995, ft_pct: 0.003, blk: 0.97, tov: 0.04 } },
};
export const MissingEstimates: Story = { args: { pCat: { ...SAMPLE_P_CAT, stl: null, ast: null } } };
/** Reused for the Teams view: P(I win each category) vs one opponent. */
export const HeadToHead: Story = {
  args: { title: 'Head-to-head vs you', subtitle: 'P(you win each category) vs Fictional Five', valueWord: 'for you' },
};
