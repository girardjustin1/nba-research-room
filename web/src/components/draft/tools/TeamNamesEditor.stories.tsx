import type { Meta, StoryObj } from '@storybook/react-vite';
import { makeSession } from '../../../mocks/draft/fixtures';
import { notFound } from '../../../mocks/draft/room';
import { TeamNamesEditor } from './TeamNamesEditor';

const meta = {
  title: 'Draft/Tools/Team Names Editor',
  component: TeamNamesEditor,
  args: {
    open: true,
    session: makeSession({ mySlot: 5, currentPick: 1 }),
    onClose: () => {},
    onSave: async () => {
      await new Promise((r) => setTimeout(r, 300));
    },
  },
} satisfies Meta<typeof TeamNamesEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Blank: Story = { args: { session: { ...makeSession({ mySlot: 5, currentPick: 1 }), team_names: {} } } };
export const SaveEndpointMissing: Story = {
  args: {
    onSave: async () => {
      throw notFound;
    },
  },
};
