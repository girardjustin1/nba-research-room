import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { modelsEmpty, modelsNormal } from '../../../mocks/app-shell/system';
import { ModelsView } from './ModelsView';

const baselineOnly = { ...modelsNormal, models: modelsNormal.models.filter((m) => m.model === 'baseline') };

const meta = {
  title: 'App Shell/System/Models',
  component: ModelsView,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}><Story /></Box>],
  args: { models: modelsNormal, onRetry: () => {} },
} satisfies Meta<typeof ModelsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ridge selected against the gray baseline reference. */
export const AgainstBaseline: Story = {};
/** LightGBM: sharper on some stats, under-covers its 80% band. */
export const Overconfident: Story = { args: { initialModel: 'lgbm' } };
/** Today's real situation: only the baseline exists. */
export const BaselineOnly: Story = { args: { models: baselineOnly } };
export const Empty: Story = { args: { models: modelsEmpty } };
export const Loading: Story = { args: { models: null, loading: true } };
export const ApiDown: Story = { args: { models: null, error: 'The draft API is not reachable' } };
