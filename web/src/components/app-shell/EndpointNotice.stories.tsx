import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { ApiError } from '../../api/client';
import { EndpointNotice } from './EndpointNotice';

const meta = {
  title: 'App Shell/Endpoint Notice',
  component: EndpointNotice,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Box>],
  args: { error: new ApiError(404, 'Not Found'), endpoint: 'GET /draft/teams', what: 'Team rosters and needs' },
} satisfies Meta<typeof EndpointNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The running API predates the endpoint. */
export const NotThereYet: Story = {};
export const Failed: Story = { args: { error: new ApiError(500, 'Request failed (HTTP 500)') } };
