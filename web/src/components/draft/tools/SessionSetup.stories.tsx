import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../../../api/client';
import { CATEGORIES, makeSession } from '../../../mocks/draft/fixtures';
import { SessionSetup } from './SessionSetup';

const ok = async () => {
  await new Promise((r) => setTimeout(r, 400));
};

const meta = {
  title: 'Draft/Tools/Session Setup',
  component: SessionSetup,
  args: { session: null, categories: CATEGORIES, teams: 14, onStart: ok, onResume: ok },
} satisfies Meta<typeof SessionSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewDraft: Story = {};
/** A session exists (e.g. started by the listener) but has no draft slot yet. */
export const ResumeWithoutSlot: Story = { args: { session: makeSession({ mySlot: null, currentPick: 9 }) } };
export const StartFails: Story = {
  args: {
    onStart: async () => {
      await new Promise((r) => setTimeout(r, 300));
      throw new ApiError(400, 'no external projections loaded: run make projections');
    },
  },
};
