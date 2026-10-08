import type { Meta, StoryObj } from '@storybook/react-vite';
import { YahooAttribution } from './YahooAttribution';

/** The footer shown on every live League and Draft page (never in the demo). */
const meta = {
  title: 'App Shell/Yahoo Attribution',
  component: YahooAttribution,
} satisfies Meta<typeof YahooAttribution>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Footer: Story = {};
/** League pages: clears the fixed bottom tab bar. */
export const AboveLeagueNav: Story = { args: { bottomOffset: 60 } };
