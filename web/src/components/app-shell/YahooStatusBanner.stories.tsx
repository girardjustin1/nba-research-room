import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { fn } from 'storybook/test';
import { yahooDown, yahooLive, yahooNoAccess, yahooSlow } from '../../mocks/app-shell/yahooStatus';
import { YahooStatusBanner } from './YahooStatusBanner';

const meta = {
  title: 'App Shell/Yahoo Status Banner',
  component: YahooStatusBanner,
  decorators: [(Story) => <Box sx={{ minHeight: 240 }}><Story /></Box>],
  args: { status: yahooSlow, onDismiss: fn(), bottomOffset: 60 },
} satisfies Meta<typeof YahooStatusBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Yahoo didn't answer within the page's time limit. */
export const Slow: Story = {};
/** Yahoo answered with an error. */
export const Down: Story = { args: { status: yahooDown } };
/** Signed in, but Yahoo hasn't given the app access to the league (today's state). */
export const NoAccess: Story = { args: { status: yahooNoAccess } };
/** Read fine: nothing shows. */
export const Live: Story = { args: { status: yahooLive } };
