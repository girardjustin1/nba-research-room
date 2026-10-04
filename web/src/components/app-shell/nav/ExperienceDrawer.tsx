import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import SportsBasketballOutlinedIcon from '@mui/icons-material/SportsBasketballOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import { EXPERIENCE_HOME, EXPERIENCE_LABEL } from '../../../app/experiences';
import type { Experience } from '../../../app/types';
import { SAFE_BOTTOM, SAFE_TOP } from '../../../lib/layout';
import { useResolvedMode } from '../../../theme/viz';

export type ApiState = 'up' | 'down' | 'checking' | 'mock' | 'demo';

export interface DrawerDestination {
  path: string;
  title: string;
}

export interface ExperienceDrawerProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  current: Experience;
  path: string;
  /** Secondary destinations of the current experience (from the route manifest). */
  destinations: DrawerDestination[];
  navigate: (path: string) => void;
  apiState: ApiState;
  /** Remembered last path per experience, so switching back resumes where you were. */
  resumePath?: (e: Experience) => string | null;
  /** Demo build: restores the starting sample draft. */
  onResetDemo?: () => void;
}

const ICON: Record<Experience, React.ReactNode> = {
  draft: <SportsBasketballOutlinedIcon />,
  league: <ViewQuiltOutlinedIcon />,
  system: <MonitorHeartOutlinedIcon />,
};

const API_TEXT: Record<ApiState, { text: string; Icon: typeof CloudDoneOutlinedIcon }> = {
  up: { text: 'Draft API connected (127.0.0.1:8765)', Icon: CloudDoneOutlinedIcon },
  down: { text: 'Draft API unreachable: run make draft-api', Icon: CloudOffOutlinedIcon },
  checking: { text: 'Checking the draft API…', Icon: SyncOutlinedIcon },
  mock: { text: 'Storybook: sample data, no API', Icon: ScienceOutlinedIcon },
  demo: { text: 'Demo: sample data, no server', Icon: ScienceOutlinedIcon },
};

const iOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * Left drawer that separates the three experiences (swipe from the left edge or tap ☰).
 * The current experience is highlighted and lists its own screens; the light/dark switch
 * and the API status sit at the bottom.
 */
export function ExperienceDrawer({ open, onOpen, onClose, current, path, destinations, navigate, apiState, resumePath, onResetDemo }: ExperienceDrawerProps) {
  const { setMode } = useColorScheme();
  const mode = useResolvedMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  const api = API_TEXT[apiState];
  const go = (p: string) => {
    onClose();
    navigate(p);
  };
  const base = path.split('?')[0];

  return (
    <SwipeableDrawer
      anchor="left"
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      disableBackdropTransition={!iOS}
      disableDiscovery={iOS}
      swipeAreaWidth={16}
      slotProps={{ paper: { sx: { width: 300, maxWidth: '85vw', pt: SAFE_TOP, pb: SAFE_BOTTOM, display: 'flex', flexDirection: 'column' } } }}
    >
      <Typography variant="overline" sx={{ px: 2, pt: 1.5, color: 'text.secondary' }}>
        NBA research room
      </Typography>
      <Box component="nav" aria-label="Experiences" sx={{ flex: 1, overflowY: 'auto' }}>
        <List>
          {(Object.keys(EXPERIENCE_LABEL) as Experience[]).map((e) => {
            const selected = e === current;
            return (
              <Box key={e}>
                <ListItemButton
                  selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => go(selected ? EXPERIENCE_HOME[e] : (resumePath?.(e) ?? EXPERIENCE_HOME[e]))}
                  sx={{ minHeight: 60 }}
                >
                  <ListItemIcon>{ICON[e]}</ListItemIcon>
                  <ListItemText primary={EXPERIENCE_LABEL[e].title} secondary={EXPERIENCE_LABEL[e].subtitle} slotProps={{ primary: { sx: { fontWeight: 700 } } }} />
                </ListItemButton>
                {selected && destinations.length > 1 && (
                  <List dense disablePadding aria-label={`${EXPERIENCE_LABEL[e].title} screens`}>
                    {destinations.map((d) => (
                      <ListItemButton
                        key={d.path}
                        selected={d.path === base}
                        aria-current={d.path === base ? 'page' : undefined}
                        onClick={() => go(d.path)}
                        sx={{ pl: 9, minHeight: 44 }}
                      >
                        <ListItemText primary={d.title} />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </Box>
            );
          })}
        </List>
      </Box>
      <Divider />
      <List dense>
        {onResetDemo && (
          <ListItemButton
            onClick={() => {
              onClose();
              onResetDemo();
            }}
            sx={{ minHeight: 48 }}
          >
            <ListItemIcon>
              <RestartAltOutlinedIcon />
            </ListItemIcon>
            <ListItemText primary="Reset demo" secondary="Restore the starting sample draft" />
          </ListItemButton>
        )}
        <ListItemButton onClick={() => setMode(next)} sx={{ minHeight: 48 }}>
          <ListItemIcon>{mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}</ListItemIcon>
          <ListItemText primary={`Switch to ${next} mode`} />
        </ListItemButton>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.25 }} role="status" aria-live="polite">
          <api.Icon fontSize="small" sx={{ color: apiState === 'down' ? 'error.main' : 'text.secondary' }} aria-hidden />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {api.text}
          </Typography>
        </Box>
      </List>
    </SwipeableDrawer>
  );
}
