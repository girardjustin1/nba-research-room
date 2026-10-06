import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMockApis, unreachableFetch } from '../../../mocks/app-shell/apis';
import { SystemScreen } from './SystemScreen';

const meta = {
  title: 'App Shell/System/Screen',
  component: SystemScreen,
  args: { tab: 'health', mode: 'mock', apis: createMockApis(), navigate: () => {}, query: new URLSearchParams() },
} satisfies Meta<typeof SystemScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Health: Story = {};
export const DraftReadiness: Story = { args: { tab: 'draft' } };
export const Models: Story = { args: { tab: 'models' } };
export const Live: Story = { args: { tab: 'live' } };
export const Updates: Story = { args: { tab: 'notes' } };
/** Live mode with the endpoint missing (404): sample data with the "Prototype data" chip. */
export const EndpointMissing: Story = { args: { mode: 'live' } };
export const ApiDown: Story = { args: { mode: 'live', apis: createMockApis(unreachableFetch) } };
