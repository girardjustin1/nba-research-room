import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { MarkdownText } from './MarkdownText';

const meta = {
  title: 'App Shell/System/Markdown Text',
  component: MarkdownText,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Box>],
  args: {
    source: 'Run `make nightly` after **updating** the key.\n\n- Save `matchup.csv`\n- Run `make inbox`\n\nSee [the notes](https://example.invalid/notes). A bad link [here](javascript:alert(1)) stays text.\n\n<b>HTML</b> is shown as text.',
  },
} satisfies Meta<typeof MarkdownText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightMarkdown: Story = {};
export const PlainText: Story = { args: { source: 'One plain paragraph with no markup at all.' } };
