import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PlayerAvatar, TeamBadge } from './PlayerAvatar';

const meta = {
  title: 'Foundations/Avatars/Player Avatar',
  component: PlayerAvatar,
  decorators: [(Story) => <Stack spacing={2} sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Stack>],
  args: { name: 'Sample Guard A', headshotUrl: null, size: 40 },
} satisfies Meta<typeof PlayerAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Invented players have no headshot: initials. */
export const Initials: Story = {};
/** A headshot path that fails to load falls back to initials too. */
export const BrokenImage: Story = { args: { headshotUrl: '/images/players/does-not-exist.png' } };
export const Sizes: Story = {
  render: (args) => (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      {[28, 32, 36, 40].map((s) => (
        <PlayerAvatar key={s} {...args} size={s} />
      ))}
    </Stack>
  ),
};
/** No cached logo: only the abbreviation shows. */
export const TeamWithoutLogo: Story = {
  render: () => (
    <Typography variant="body2">
      SF, F · <TeamBadge abbr="NTH" logoUrl={null} /> · Tier 2
    </Typography>
  ),
};
