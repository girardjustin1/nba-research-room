import type { Meta, StoryObj } from '@storybook/react-vite';
import { PrototypeDataChip } from './PrototypeDataChip';

const meta = {
  title: 'App Shell/Prototype Data Chip',
  component: PrototypeDataChip,
  args: { endpoints: ['GET /season/week', 'POST /season/scenario'], bottomOffset: 0 },
} satisfies Meta<typeof PrototypeDataChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Persistent while sample data is on screen; tap for the endpoints. */
export const Shown: Story = {};
export const AboveBottomNav: Story = { args: { bottomOffset: 60 } };
/** No mocked endpoints: renders nothing. */
export const Hidden: Story = { args: { endpoints: [] } };
