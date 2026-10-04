import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { CATEGORIES, onTheClockBoard } from '../../../mocks/draft/fixtures';
import { DpChart } from './DpChart';

const rec = onTheClockBoard.recommendations[0]!;

const meta = {
  title: 'Draft/Charts/Win Chance by Category',
  component: DpChart,
  decorators: [(Story) => <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}><Story /></Card>],
  args: { rec, categories: CATEGORIES, scaleMax: 0.03 },
} satisfies Meta<typeof DpChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Per-category change in my win chance if I take him (the board's dp_<category>). */
export const Default: Story = {};
export const AllNeutral: Story = {
  args: { rec: { ...rec, ...Object.fromEntries(CATEGORIES.map((c) => [`dp_${c.key}`, 0])) } },
};
/** An older API without dp_ fields: renders nothing. */
export const NoDpFields: Story = {
  args: { rec: Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('dp_'))) as typeof rec },
};
