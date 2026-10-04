import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { SignedBarChart } from './SignedBarChart';

const ROWS = [
  { key: 'a', label: 'Helps a lot', value: 0.11, display: '+11' },
  { key: 'b', label: 'Helps', value: 0.04, display: '+4' },
  { key: 'c', label: 'About even', value: 0.004, display: '±0' },
  { key: 'd', label: 'Hurts', value: -0.03, display: '−3' },
  { key: 'e', label: 'Punted', value: -0.05, display: '−5', neutral: true },
  { key: 'f', label: 'No estimate', value: null, display: '—' },
];

/** Diverging bars colored for me (green helps, red hurts, gray even), MUI X BarChart. */
const meta = {
  title: 'Foundations/Signed Bar Chart',
  component: SignedBarChart,
  decorators: [
    (Story) => (
      <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}>
        <Story />
      </Card>
    ),
  ],
  args: {
    title: 'Change in P(win)',
    subtitle: 'Sample rows, invented',
    rows: ROWS,
    domain: 0.16,
    ticks: [-0.1, 0, 0.1],
    tickFormat: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`,
    evenBand: 0.005,
    table: { headers: ['Row', 'Value'], cells: (r: { label: string; display: string }) => [r.label, r.display] },
  },
} satisfies Meta<typeof SignedBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TableView: Story = { args: { initialView: 'table' } };
/** For an opponent's numbers: their gain is red for me. */
export const Inverted: Story = { args: { invert: true, title: 'Opponent strength' } };
export const Dark: Story = { globals: { colorMode: 'dark' } };
