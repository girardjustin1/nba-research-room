import { useState } from 'react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import type { PickInsight } from '../../../api/types';
import { LatestPickCard } from './LatestPickCard';

/** How many recent picks the list shows. */
export const BELL_PICKS = 14;

export interface PickFeedBellProps {
  /** The live read after each pick (oldest first, as GET /draft/insights returns them). */
  insights: PickInsight[] | null;
  teams: number;
  /** Picks after this one are unread (the badge counts them). */
  seenPick: number;
  /** Opening the list marks everything up to the newest pick read. */
  onSeen: (pickNo: number) => void;
  /** Open that team's detail (Teams view). */
  onOpenTeam: (teamId: number) => void;
  /** Stories: start with the list open. */
  defaultOpen?: boolean;
}

/**
 * The status bar's bell: the newest picks with the engine's read on each (that team's needs,
 * strengths, my odds against them), newest first. A badge counts the picks not looked at yet;
 * nothing pops over the board.
 */
export function PickFeedBell({ insights, teams, seenPick, onSeen, onOpenTeam, defaultOpen = false }: PickFeedBellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [openOnMount, setOpenOnMount] = useState(defaultOpen);
  const recent = [...(insights ?? [])].sort((a, b) => b.pick_no - a.pick_no).slice(0, BELL_PICKS);
  const unread = (insights ?? []).filter((i) => i.pick_no > seenPick).length;
  const newest = recent[0]?.pick_no ?? 0;
  const open = Boolean(anchor) || openOnMount;

  return (
    <>
      <IconButton
        aria-label={unread ? `Latest picks, ${unread} new` : 'Latest picks'}
        ref={(el) => {
          if (openOnMount && el && !anchor) setAnchor(el);
        }}
        onClick={(e) => {
          setAnchor(e.currentTarget);
          onSeen(newest);
        }}
        sx={{ color: 'inherit' }}
      >
        <Badge badgeContent={unread} color="warning" max={99}>
          {unread ? <NotificationsActiveOutlinedIcon /> : <NotificationsNoneOutlinedIcon />}
        </Badge>
      </IconButton>
      <Popover
        open={open && Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          setOpenOnMount(false);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 'min(400px, calc(100vw - 32px))', maxHeight: '70vh', p: 1.25 } } }}
      >
        <Typography variant="subtitle2" component="h2" sx={{ px: 0.5, pb: 1 }}>
          Latest picks
        </Typography>
        {recent.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 0.5, pb: 0.5 }}>
            No picks yet. Each pick shows here with what it means for that team and for you.
          </Typography>
        ) : (
          <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {recent.map((i) => (
              <Box component="li" key={i.pick_no}>
                <LatestPickCard
                  insight={i}
                  teams={teams}
                  flat
                  onOpenTeam={(t) => {
                    setAnchor(null);
                    setOpenOnMount(false);
                    onOpenTeam(t);
                  }}
                />
              </Box>
            ))}
          </Stack>
        )}
      </Popover>
    </>
  );
}
