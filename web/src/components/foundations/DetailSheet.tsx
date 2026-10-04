import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { SAFE_BOTTOM, SAFE_TOP } from '../../lib/layout';

export interface SheetSection {
  heading: string;
  lines: string[];
}

export interface SheetAction {
  label: string;
  onClick: () => void;
}

/** The content a grid cell opens: built from engine numbers by the screen's adapter. */
export interface SheetContent {
  title: string;
  subtitle?: string;
  /** One line with the for-me symbol and words, e.g. "▼ Hurts you: your player misses a game". */
  effect?: string | null;
  sections: SheetSection[];
  actions?: SheetAction[];
}

export interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  content: SheetContent | null;
  /** Extra content below the sections. */
  children?: ReactNode;
}

/**
 * Bottom sheet for a tapped cell (MUI SwipeableDrawer anchored bottom): swipe down or tap
 * Close to dismiss. Grows to near full height on long content and pads for the safe areas.
 */
export function DetailSheet({ open, onClose, content, children }: DetailSheetProps) {
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open && content != null}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: `calc(100dvh - ${SAFE_TOP} - 12px)`,
            pb: SAFE_BOTTOM,
            maxWidth: 640,
            mx: 'auto',
          },
          'aria-labelledby': 'detail-sheet-title',
        },
      }}
    >
      {content && (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box aria-hidden sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
            <Box sx={{ width: 40, height: 5, borderRadius: 3, bgcolor: 'text.disabled' }} />
          </Box>
          <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1, px: 2, pt: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography id="detail-sheet-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
                {content.title}
              </Typography>
              {content.subtitle && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {content.subtitle}
                </Typography>
              )}
            </Box>
            <IconButton aria-label="Close" onClick={onClose} sx={{ mr: -1 }}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <Box sx={{ overflowY: 'auto', px: 2, py: 1.5 }}>
            {content.effect && (
              <Typography variant="body1" sx={{ fontWeight: 700, mb: 1 }}>
                {content.effect}
              </Typography>
            )}
            {content.sections.map((s) => (
              <Box key={s.heading} component="section" sx={{ mb: 1.5 }}>
                <Typography variant="overline" component="h3" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                  {s.heading}
                </Typography>
                {s.lines.map((l) => (
                  <Typography key={l} variant="body2" sx={{ mb: 0.25 }}>
                    {l}
                  </Typography>
                ))}
              </Box>
            ))}
            {children}
            {content.actions && content.actions.length > 0 && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {content.actions.map((a) => (
                  <Button key={a.label} variant="outlined" fullWidth onClick={a.onClick}>
                    {a.label}
                  </Button>
                ))}
              </Stack>
            )}
          </Box>
        </Box>
      )}
    </SwipeableDrawer>
  );
}
