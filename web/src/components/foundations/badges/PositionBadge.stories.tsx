import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { PositionBadge } from './PositionBadge';

const meta = {
  title: 'Foundations/Badges/Position Badge',
  component: PositionBadge,
  decorators: [(Story) => <Stack sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { pos: 'PG' },
} satisfies Meta<typeof PositionBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Colors are by group (guards, forwards, centers); the label always names the position. */
export const All: Story = {
  render: () => (
    <Stack direction="row" spacing={1}>
      {['PG', 'SG', 'SF', 'PF', 'C', null].map((p) => (
        <PositionBadge key={String(p)} pos={p} size="medium" />
      ))}
    </Stack>
  ),
};
