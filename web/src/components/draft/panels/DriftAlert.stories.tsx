import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { CATEGORIES } from '../../../mocks/draft/fixtures';
import { DriftAlert } from './DriftAlert';

const meta = {
  title: 'Draft/Panels/Drift Alert',
  component: DriftAlert,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Box>],
  args: { categories: CATEGORIES, drift: ['ft_pct'] },
} satisfies Meta<typeof DriftAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneCategory: Story = {};
export const SeveralCategories: Story = { args: { drift: ['ft_pct', 'ast', 'tov'] } };
/** Empty drift list: renders nothing. */
export const NoDrift: Story = { args: { drift: [] } };
