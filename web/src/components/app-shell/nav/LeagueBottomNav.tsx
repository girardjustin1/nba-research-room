import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';

import type { LeagueTab } from '../../../app/experiences';

/** League bottom tabs: Matchup · Team · Players · Teams · Results (60px, sits on the safe area). */
export function LeagueBottomNav({ value, onChange }: { value: LeagueTab | null; onChange: (tab: LeagueTab) => void }) {
  return (
    <BottomNavigation value={value ?? false} onChange={(_, v: LeagueTab) => onChange(v)} showLabels sx={{ height: 60, bgcolor: 'transparent' }}>
      <BottomNavigationAction value="matchup" label="Matchup" icon={<ViewWeekOutlinedIcon />} />
      <BottomNavigationAction value="team" label="Team" icon={<EventNoteOutlinedIcon />} />
      <BottomNavigationAction value="players" label="Players" icon={<PersonSearchOutlinedIcon />} />
      <BottomNavigationAction value="teams" label="Teams" icon={<GroupsOutlinedIcon />} />
      <BottomNavigationAction value="results" label="Results" icon={<EmojiEventsOutlinedIcon />} />
    </BottomNavigation>
  );
}
