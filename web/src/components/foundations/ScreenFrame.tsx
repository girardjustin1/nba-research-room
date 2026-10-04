import { useContext, useEffect, type ReactNode } from 'react';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import TravelExploreOutlinedIcon from '@mui/icons-material/TravelExploreOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
import type { IsoDateTime } from '../../api/season';
import { SAFE_BOTTOM, SAFE_TOP } from '../../lib/layout';
import { useResolvedMode } from '../../theme/viz';
import { ShellAdoptionContext, useAppShell, type ShellPart } from '../app-shell/AppShellContext';
import { etClock, weekdayOf, etDate } from './seasonFormat';

export type SeasonTab = 'matchup' | 'builder' | 'research' | 'results' | 'alerts';

function ColorModeToggle() {
  const { setMode } = useColorScheme();
  const resolved = useResolvedMode();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <IconButton aria-label={`Switch to ${next} mode`} onClick={() => setMode(next)} sx={{ color: 'inherit', mr: -1 }}>
      {resolved === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
    </IconButton>
  );
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Response `as_of`; shown as "as of 5:42 pm". */
  asOf?: IsoDateTime | null;
  stale?: boolean;
  onBack?: () => void;
  backLabel?: string;
}

/** Tell the app shell (when present) which of its parts this screen renders, so its fallback hides. */
function useAdopt(parts: ShellPart[], active: boolean) {
  const adopt = useContext(ShellAdoptionContext);
  const key = parts.join(',');
  useEffect(() => {
    if (!adopt || !active) return undefined;
    const offs = key.split(',').map((p) => adopt(p as ShellPart));
    return () => offs.forEach((off) => off());
  }, [adopt, active, key]);
}

/**
 * Sticky top bar: the app shell's ☰ (inside the app), back (optional), title + subtitle,
 * data freshness, the shell's header actions (e.g. the Notifications bell), light/dark toggle.
 */
export function ScreenHeader({ title, subtitle, asOf, stale, onBack, backLabel = 'Back' }: ScreenHeaderProps) {
  const shell = useAppShell();
  useAdopt(['menu', 'actions'], shell != null);
  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 'appBar',
        pt: SAFE_TOP,
        px: 2,
        pb: 1,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minHeight: 44 }}>
        {shell?.menuButton}
        {onBack && (
          <IconButton aria-label={backLabel} onClick={onBack} sx={{ ml: -1.5 }}>
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h1" noWrap sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" component="p" noWrap sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {asOf && (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography
              variant="caption"
              component="p"
              sx={[
                {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'text.secondary',
                  lineHeight: 1.3,
                },
                !!stale && { color: 'warning.dark', fontWeight: 600 },
              ]}
            >
              {stale && <ReportProblemOutlinedIcon sx={{ fontSize: 14 }} aria-hidden />}
              {stale ? 'Stale' : 'Updated'}
            </Typography>
            <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary', lineHeight: 1.3 }}>
              {weekdayOf(etDate(asOf))} {etClock(asOf)}
            </Typography>
          </Box>
        )}
        {shell?.headerActions}
        <ColorModeToggle />
      </Stack>
    </Box>
  );
}

export interface SeasonShellProps {
  tab: SeasonTab;
  onTabChange?: (tab: SeasonTab) => void;
  header: ReactNode;
  children: ReactNode;
  /** Pinned above the bottom navigation (e.g. a primary action). */
  footer?: ReactNode;
  /** Unread alert count for the Alerts tab label. */
  alerts?: number;
}

/**
 * The in-season frame: sticky header, one scrolling section, bottom navigation. Tabs map to
 * the app's stages: Matchup Analysis, Team Builder, Team & Player Analysis (Research),
 * Results, Notifications. Player and team profiles open on top from any row.
 */
export function SeasonShell({ tab, onTabChange, header, children, footer, alerts }: SeasonShellProps) {
  const shell = useAppShell();
  useAdopt(['nav'], shell?.bottomNav != null);
  return (
    <Box
      sx={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        overflow: 'hidden',
        maxWidth: 640,
        mx: 'auto',
      }}
    >
      {header}
      <Box
        component="main"
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 2,
          pt: 1.5,
          pb: 3,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </Box>
      {footer && (
        <Box
          sx={{
            px: 2,
            py: 1,
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          {footer}
        </Box>
      )}
      <Paper square sx={{ borderTop: 1, borderColor: 'divider', pb: SAFE_BOTTOM }}>
        {shell?.bottomNav ?? (
          <BottomNavigation value={tab} onChange={(_, v: SeasonTab) => onTabChange?.(v)} showLabels sx={{ height: 60, bgcolor: 'transparent' }}>
            <BottomNavigationAction value="matchup" label="Matchup" icon={<ViewWeekOutlinedIcon />} />
            <BottomNavigationAction value="builder" label="Team" icon={<EventNoteOutlinedIcon />} />
            <BottomNavigationAction value="research" label="Research" icon={<TravelExploreOutlinedIcon />} />
            <BottomNavigationAction value="results" label="Results" icon={<EmojiEventsOutlinedIcon />} />
            <BottomNavigationAction value="alerts" label={alerts ? `Alerts (${alerts})` : 'Alerts'} icon={<NotificationsNoneOutlinedIcon />} />
          </BottomNavigation>
        )}
      </Paper>
    </Box>
  );
}
