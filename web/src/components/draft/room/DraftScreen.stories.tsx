import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMockApis } from '../../../mocks/app-shell/apis';
import { DraftScreen } from './DraftScreen';

/** The #/draft route screen: the real DraftRoom container (polling) on the mock draft API. */
const meta = {
  title: 'Draft/Room/Live Container',
  component: DraftScreen,
  args: { mode: 'mock', apis: createMockApis(), navigate: () => {}, query: new URLSearchParams() },
} satisfies Meta<typeof DraftScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnMockApi: Story = {};
