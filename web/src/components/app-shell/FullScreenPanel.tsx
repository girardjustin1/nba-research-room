import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { SAFE_BOTTOM, SAFE_TOP } from '../../lib/layout';

export interface FullScreenPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned at the bottom, thumb-reachable (e.g. a Save button). */
  footer?: ReactNode;
}

/** A full-screen sheet with a title bar, safe-area padding, and a close button. */
export function FullScreenPanel({ open, title, onClose, children, footer }: FullScreenPanelProps) {
  return (
    <Dialog fullScreen open={open} onClose={onClose} aria-labelledby="fsp-title">
      <Stack sx={{ height: '100dvh', bgcolor: 'background.default' }}>
        <Stack direction="row" sx={{ alignItems: 'center', pt: SAFE_TOP, px: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
          <Typography id="fsp-title" variant="subtitle1" component="h2" sx={{ flex: 1, ml: 0.5 }} noWrap>
            {title}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>{children}</Box>
        {footer && (
          <Box sx={{ px: 2, pt: 1, pb: `calc(${SAFE_BOTTOM} + 8px)`, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
            {footer}
          </Box>
        )}
      </Stack>
    </Dialog>
  );
}
