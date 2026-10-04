import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { Meter } from './Meter';

const meta = {
  title: 'Foundations/Charts/Meter',
  component: Meter,
  decorators: [(Story) => <Stack spacing={2} sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { value: 0.62, label: 'My pick', detail: '#33' },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Low: Story = { args: { value: 0.04, label: 'Next pick', detail: '#52' } };
export const Missing: Story = { args: { value: null, label: 'Next pick', detail: 'none' } };
