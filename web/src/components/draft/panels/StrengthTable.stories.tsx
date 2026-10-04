import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { makeStrength, puntSession, waitingSession } from '../../../mocks/draft/fixtures';
import { notFound } from '../../../mocks/draft/room';
import { StrengthTable } from './StrengthTable';

const meta = {
  title: 'Draft/Panels/Me vs League',
  component: StrengthTable,
  decorators: [(Story) => <Box sx={{ p: 2, bgcolor: 'background.default' }}><Story /></Box>],
  args: { strength: makeStrength(waitingSession) },
} satisfies Meta<typeof StrengthTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Per category: me, league average, best team, my rank (▲/▼ vs the average). */
export const Normal: Story = {};
/** Punted categories are gray and carry no ▲/▼. */
export const Punting: Story = { args: { strength: makeStrength(puntSession) } };
export const Loading: Story = { args: { strength: null, loading: true } };
/** The running API predates GET /draft/strength. */
export const EndpointMissing: Story = { args: { strength: null, error: notFound } };
