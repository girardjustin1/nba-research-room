import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { BellButton, MenuButton } from './ShellButtons';

const meta = {
  title: 'App Shell/Navigation/Shell Buttons',
  component: MenuButton,
  decorators: [(Story) => <Stack direction="row" spacing={2} sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { onClick: () => {} },
} satisfies Meta<typeof MenuButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Menu: Story = {};
export const Bell: Story = { render: () => <BellButton onClick={() => {}} /> };
export const BellWithUnread: Story = { render: () => <BellButton onClick={() => {}} unread={3} /> };
