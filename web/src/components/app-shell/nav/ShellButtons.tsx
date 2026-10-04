import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';

/** Left ☰ that opens the experience drawer. */
export function MenuButton({ onClick, color = 'inherit' }: { onClick: () => void; color?: string }) {
  return (
    <IconButton aria-label="Open menu: Draft, League, System" onClick={onClick} sx={{ color, ml: -1 }}>
      <MenuIcon />
    </IconButton>
  );
}

/** League header bell: opens Notifications; the count is the API's unread count when known. */
export function BellButton({ onClick, unread }: { onClick: () => void; unread?: number | null }) {
  return (
    <IconButton aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={onClick} sx={{ color: 'inherit' }}>
      <Badge color="primary" badgeContent={unread ?? 0} max={99} invisible={!unread}>
        <NotificationsNoneOutlinedIcon />
      </Badge>
    </IconButton>
  );
}
