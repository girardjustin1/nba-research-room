import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { makePositional } from '../../../mocks/draft/fixtures';
import { notFound } from '../../../mocks/draft/room';
import { PositionalValuePanel } from './PositionalValuePanel';

const meta = {
  title: 'Draft/Panels/Positional Value Panel',
  component: PositionalValuePanel,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', width: 190 }}><Story /></Box>],
  args: { positions: makePositional() },
} satisfies Meta<typeof PositionalValuePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bars on the engine's Low→High scale, colored by position group; the (i) has the table. */
export const Default: Story = {};
export const CentersScarce: Story = { args: { positions: makePositional([0.2, 0.25, 0.3, 0.45, 0.95]) } };
export const Loading: Story = { args: { positions: null, loading: true } };
export const EndpointMissing: Story = { args: { positions: null, error: notFound } };
