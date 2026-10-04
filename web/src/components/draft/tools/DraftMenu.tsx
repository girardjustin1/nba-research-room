import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import DriveFileRenameOutlineOutlinedIcon from '@mui/icons-material/DriveFileRenameOutlineOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import FormatListNumberedOutlinedIcon from '@mui/icons-material/FormatListNumberedOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import { useColorScheme } from '@mui/material/styles';
import { SAFE_TOP } from '../../../lib/layout';
import { useResolvedMode } from '../../../theme/viz';

export type MenuPanel = 'recommendations' | 'entry' | 'log' | 'tiers' | 'names';

export interface DraftMenuProps {
  open: boolean;
  onClose: () => void;
  onOpenPanel: (panel: MenuPanel) => void;
}

const ITEMS: { panel: MenuPanel; label: string; detail: string; icon: React.ReactNode }[] = [
  { panel: 'recommendations', label: 'Top 10 with reasons', detail: 'Gain, win chance, availability, why', icon: <FormatListNumberedOutlinedIcon /> },
  { panel: 'entry', label: 'Enter pick / Undo', detail: 'Manual entry for any team', icon: <EditNoteOutlinedIcon /> },
  { panel: 'log', label: 'Draft log', detail: 'Every pick, newest first', icon: <HistoryOutlinedIcon /> },
  { panel: 'tiers', label: 'Tiers', detail: 'Available players by tier', icon: <LayersOutlinedIcon /> },
  { panel: 'names', label: 'Edit team names', detail: 'As shown in the Yahoo room', icon: <DriveFileRenameOutlineOutlinedIcon /> },
];

/** Side menu for the less frequent draft tools. */
export function DraftMenu({ open, onClose, onOpenPanel }: DraftMenuProps) {
  const { setMode } = useColorScheme();
  const mode = useResolvedMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 300, maxWidth: '85vw', pt: SAFE_TOP } } }}>
      <Typography variant="overline" sx={{ px: 2, pt: 1.5, color: 'text.secondary' }}>
        Draft tools
      </Typography>
      <List>
        {ITEMS.map((it) => (
          <ListItemButton
            key={it.panel}
            onClick={() => {
              onClose();
              onOpenPanel(it.panel);
            }}
            sx={{ minHeight: 56 }}
          >
            <ListItemIcon>{it.icon}</ListItemIcon>
            <ListItemText primary={it.label} secondary={it.detail} />
          </ListItemButton>
        ))}
        <ListItemButton onClick={() => setMode(next)} sx={{ minHeight: 56 }}>
          <ListItemIcon>{mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}</ListItemIcon>
          <ListItemText primary={`Switch to ${next} mode`} />
        </ListItemButton>
      </List>
    </Drawer>
  );
}
