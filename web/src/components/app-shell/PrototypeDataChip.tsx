import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { SAFE_BOTTOM } from '../../lib/layout';
import { useAppShell } from './AppShellContext';

export interface PrototypeDataChipProps {
  /** Endpoints answered by invented data, e.g. ["GET /season/week"]. Renders nothing when empty. */
  endpoints: string[];
  /** Height of any bottom bar the chip must sit above (px). */
  bottomOffset?: number;
}

/**
 * Persistent marker that the screen shows INVENTED data (the endpoint is not implemented
 * yet). Tap it for the list of endpoints. It never hides while mock data is on screen.
 */
export function PrototypeDataChip({ endpoints, bottomOffset = 0 }: PrototypeDataChipProps) {
  const [open, setOpen] = useState(false);
  // In the demo build everything is sample data and the app bar's demo badge already says so.
  const shell = useAppShell();
  if (endpoints.length === 0 || shell?.demoBadge) return null;
  return (
    <>
      <Box
        sx={{
          position: 'fixed',
          left: 'max(8px, calc(50% - 312px))',
          bottom: `calc(${SAFE_BOTTOM} + ${bottomOffset + 8}px)`,
          zIndex: 1250,
        }}
      >
        <Chip
          icon={<ScienceOutlinedIcon />}
          label="Prototype data"
          onClick={() => setOpen(true)}
          aria-label={`Prototype data: invented numbers from ${endpoints.join(', ')}. Tap for details.`}
          sx={{ height: 36, fontWeight: 700, bgcolor: 'background.paper', border: 2, borderColor: 'text.primary', boxShadow: 3, '&:hover': { bgcolor: 'background.paper' } }}
        />
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="proto-title">
        <DialogTitle id="proto-title">Prototype data</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            The numbers on this screen are invented. These endpoints are not implemented in the
            draft API yet, so the app shows the same sample data as Storybook:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {endpoints.map((e) => (
              <Typography key={e} component="li" variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {e}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
