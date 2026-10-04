import type { Meta, StoryObj } from '@storybook/react-vite';
import { DraftMenu } from './DraftMenu';

const meta = { title: 'Draft/Tools/Draft Menu', component: DraftMenu, args: { open: true, onClose: () => {}, onOpenPanel: () => {} } } satisfies Meta<typeof DraftMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
