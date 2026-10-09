import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import type { YahooStatus } from '../../api/system';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export interface YahooStatusBannerProps {
  status: YahooStatus | null;
  onDismiss?: () => void;
  /** Space kept below for the bottom nav (League). */
  bottomOffset?: number;
}

/**
 * Says so when the last Yahoo read failed or ran out of time: the page is then showing my own
 * entries and the last saved plan. The words come from the engine (GET /system/yahoo). Nothing
 * shows while Yahoo is read fine, or when the app isn't signed in to Yahoo at all.
 */
export function YahooStatusBanner({ status, onDismiss, bottomOffset = 0 }: YahooStatusBannerProps) {
  if (!status?.degraded) return null;
  const when = status.checked_at ? ` Checked ${fmtTime(status.checked_at)}.` : '';
  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `${bottomOffset + 8}px`,
        display: 'flex',
        justifyContent: 'center',
        px: 2,
        zIndex: (t) => t.zIndex.snackbar,
        pointerEvents: 'none',
      }}
    >
      <Alert
        severity={status.state === 'no_access' ? 'info' : 'warning'}
        onClose={onDismiss}
        role="status"
        sx={{ maxWidth: 520, width: '100%', pointerEvents: 'auto', boxShadow: 3 }}
      >
        {status.message}
        {when}
      </Alert>
    </Box>
  );
}
