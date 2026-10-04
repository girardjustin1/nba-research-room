import type { Meta, StoryObj } from '@storybook/react-vite';
import { routesFor } from '../../../app/routes';
import { ExperienceDrawer } from './ExperienceDrawer';

const meta = {
  title: 'App Shell/Navigation/Drawer',
  component: ExperienceDrawer,
  args: {
    open: true,
    onOpen: () => {},
    onClose: () => {},
    current: 'league',
    path: '#/league/matchup',
    destinations: routesFor('league').map((r) => ({ path: r.path, title: r.title })),
    navigate: () => {},
    apiState: 'up',
  },
} satisfies Meta<typeof ExperienceDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LeagueApiUp: Story = {};
export const SystemApiDown: Story = {
  args: { current: 'system', path: '#/system/models', destinations: routesFor('system').map((r) => ({ path: r.path, title: r.title })), apiState: 'down' },
};
export const DraftChecking: Story = { args: { current: 'draft', path: '#/draft', destinations: [], apiState: 'checking' } };
