import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiStatus } from './ApiStatus';

const meta = {
  title: 'Draft/ApiStatus',
  component: ApiStatus,
  args: { onRetry: () => {}, pollSeconds: 1.5 },
  decorators: [(Story) => <div style={{ paddingTop: 'var(--sim-safe-top)' }}><Story /></div>],
} satisfies Meta<typeof ApiStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unreachable: Story = { args: { connection: 'down' } };
export const Connecting: Story = { args: { connection: 'connecting' } };
/** Renders nothing once the API answers. */
export const Up: Story = { args: { connection: 'up' } };
