import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BottomSheet, type SheetSnap } from './BottomSheet';

function Demo({ start }: { start: SheetSnap }) {
  const [snap, setSnap] = useState<SheetSnap>(start);
  const [tab, setTab] = useState<'a' | 'b'>('a');
  return (
    <Box sx={{ position: 'relative', height: '100dvh', bgcolor: 'background.default', pt: 'var(--sim-safe-top)' }}>
      <Typography sx={{ p: 2 }}>Drag the grip, tap it, or use the arrow button. Now: {snap}</Typography>
      <BottomSheet tabs={[{ value: 'a', label: 'AVAILABLE' }, { value: 'b', label: 'TEAM' }]} tab={tab} onTabChange={setTab} snap={snap} onSnapChange={setSnap}>
        <Box sx={{ p: 2 }}>
          {Array.from({ length: 30 }, (_, i) => (
            <Typography key={i} sx={{ py: 1 }}>Row {i + 1}</Typography>
          ))}
        </Box>
      </BottomSheet>
    </Box>
  );
}

const meta = { title: 'App Shell/Bottom Sheet', component: Demo, args: { start: 'collapsed' } } satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Half: Story = { args: { start: 'half' } };
export const Full: Story = { args: { start: 'full' } };
