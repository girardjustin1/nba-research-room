import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { GainBar } from './GainBar';
import { Meter } from './Meter';

const meta = {
  title: 'Charts/Meter',
  component: Meter,
  decorators: [(Story) => <Stack spacing={2} sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { value: 0.62, label: 'There at my pick', detail: '#33' },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Low: Story = { args: { value: 0.04, label: 'Lasts to next', detail: '#52' } };
export const Missing: Story = { args: { value: null, label: 'Lasts to next', detail: 'none' } };
export const GainBars: Story = {
  render: () => (
    <Stack spacing={1}>
      {[0.41, 0.22, 0.05, 0, -0.08, -0.3].map((g) => (
        <GainBar key={g} gain={g} scaleMax={0.41} />
      ))}
      <GainBar gain={null} scaleMax={0.41} />
    </Stack>
  ),
};
