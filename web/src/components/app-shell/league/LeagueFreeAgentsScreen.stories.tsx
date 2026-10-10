import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMockApis, unreachableFetch } from '../../../mocks/app-shell/apis';
import { LeagueFreeAgentsScreen } from './LeagueFreeAgentsScreen';

/** League container: live data with sample-data fallback ("Prototype data"); with sample data, saving works in memory. */
const meta = {
  title: 'App Shell/League/Free agents',
  component: LeagueFreeAgentsScreen,
  args: { mode: 'mock', apis: createMockApis(), navigate: () => {}, query: new URLSearchParams() },
} satisfies Meta<typeof LeagueFreeAgentsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sample data, as in the Prototype section. */
export const SampleData: Story = {};
/** Live mode where the endpoint is not available (404): the sample data shows with the chip. */
export const EndpointMissing: Story = { args: { mode: 'live' } };
/** Live mode with the API down: the screen's own error state. */
export const ApiDown: Story = { args: { mode: 'live', apis: createMockApis(unreachableFetch) } };
