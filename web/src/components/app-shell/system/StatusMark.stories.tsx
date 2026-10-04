import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { StatusMark } from './StatusMark';

const meta = {
  title: 'App Shell/System/Status Mark',
  component: StatusMark,
  decorators: [(Story) => <Stack sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { status: 'ok' },
} satisfies Meta<typeof StatusMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Icon in the status color plus the word: never color alone. */
export const All: Story = {
  render: () => (
    <Stack spacing={1}>
      <StatusMark status="ok" />
      <StatusMark status="warn" />
      <StatusMark status="error" />
    </Stack>
  ),
};
