import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { SAFE_BOTTOM } from '../../lib/layout';

const DEMO_README_URL = 'https://github.com/girardjustin1/nba-research-room/blob/main/web/README.md#run';

export interface DemoBadgeProps {
  /** Short label for crowded headers; the full "Demo · sample data" otherwise. */
  compact?: boolean;
  onReset?: () => void;
}

/**
 * Persistent badge in the demo build's app bars. Tap: a short sheet saying this is a demo,
 * that every number is invented sample data, and how to run the real thing locally.
 */
export function DemoBadge({ compact, onReset }: DemoBadgeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Chip
        size="small"
        icon={<ScienceOutlinedIcon />}
        label={compact ? 'Demo' : 'Demo · sample data'}
        onClick={() => setOpen(true)}
        aria-label="Demo · sample data. Tap for details."
        variant="outlined"
        sx={{ height: 32, fontWeight: 700, color: 'inherit', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' }, flexShrink: 0 }}
      />
      <Drawer anchor="bottom" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: SAFE_BOTTOM } } }}>
        <Box sx={{ p: 2 }} role="dialog" aria-labelledby="demo-title">
          <Typography id="demo-title" variant="subtitle1" component="h2" sx={{ mb: 1 }}>
            Demo · sample data
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            This is a standalone demo of the NBA research room app. It never contacts a server: every
            player, team and number is invented sample data, the same data as the Storybook stories.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            You can record, change, remove and undo draft picks and rename teams. Those changes live
            only in this browser tab. Recommendations, win chances and other engine numbers stay the
            sample values: the browser never computes them. Reset demo (in the ☰ menu) starts over.
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            To run it on real data, follow the{' '}
            <Link href={DEMO_README_URL} target="_blank" rel="noopener noreferrer">
              local setup in the README
            </Link>
            .
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {onReset && (
              <Button
                variant="outlined"
                onClick={() => {
                  setOpen(false);
                  onReset();
                }}
              >
                Reset demo
              </Button>
            )}
            <Button variant="contained" onClick={() => setOpen(false)} sx={{ ml: 'auto' }}>
              Close
            </Button>
          </Box>
        </Box>
      </Drawer>
    </>
  );
}
