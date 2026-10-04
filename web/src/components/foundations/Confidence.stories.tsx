import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from './Confidence';

const missing = [
  { key: 'kalshi', label: 'No liquid Kalshi BLK market for his next game', effect: 'Used normal(mean, sd) for BLK' },
  { key: 'status', label: 'Status not confirmed', effect: null },
];

function Demo() {
  return (
    <Stack spacing={1.25} sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', alignItems: 'flex-start' }}>
      <ConfidenceChip confidence={{ level: 'high', score: 0.86, missing: [] }} />
      <ConfidenceChip confidence={{ level: 'medium', score: 0.68, missing }} />
      <ConfidenceChip confidence={{ level: 'low', score: 0.41, missing }} />
      <ConfidenceChip confidence={{ level: 'none', score: null, missing }} />
      <ConfidenceChip confidence={{ level: 'medium', score: 0.68, missing }} compact />
      <MissingInputs confidence={{ level: 'low', score: 0.41, missing }} />
      <ProvenanceLine
        provenance={[
          { module: 'simulate', as_of: '2026-11-18T17:42:00-05:00', run_id: null, note: 'Monte Carlo, 5,000 draws' },
          { module: 'yahoo', as_of: null, run_id: null, note: 'roster snapshot' },
        ]}
      />
    </Stack>
  );
}

/** Confidence (icon + words, never color alone), missing inputs, and provenance. */
const meta = { title: 'Foundations/Confidence and provenance', component: Demo } satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllLevels: Story = {};
