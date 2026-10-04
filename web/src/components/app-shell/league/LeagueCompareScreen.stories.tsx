import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMockApis, unreachableFetch } from '../../../mocks/app-shell/apis';
import { LeagueCompareScreen } from './LeagueCompareScreen';

/** League container: live data with sample-data fallback ("Prototype data"). Outside the app shell it shows season-ui's own frame. */
const meta = {
  title: 'App Shell/League/Compare',
  component: LeagueCompareScreen,
  args: { mode: 'mock', apis: createMockApis(), navigate: () => {}, query: new URLSearchParams() },
} satisfies Meta<typeof LeagueCompareScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sample data, as in the Prototype section. */
export const SampleData: Story = {};
/** Live mode where the endpoint is not implemented (404): the sample data shows with the chip. */
export const EndpointMissing: Story = { args: { mode: 'live' } };
/** Live mode with the API down: the screen's own error state, no invented numbers. */
export const ApiDown: Story = { args: { mode: 'live', apis: createMockApis(unreachableFetch) } };
