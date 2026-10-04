import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import type { Connection } from '../../api/useDraftRoom';

export interface ApiStatusProps {
  connection: Connection;
  onRetry?: () => void;
  /** Poll interval, shown so the user knows it retries on its own. */
  pollSeconds?: number;
}

/** Full-screen state for when the local draft API is not reachable (or still connecting). */
export function ApiStatus({ connection, onRetry, pollSeconds = 1.5 }: ApiStatusProps) {
  if (connection === 'up') return null;
  if (connection === 'connecting') {
    return (
      <Stack role="status" spacing={1} sx={{ alignItems: 'center', py: 6, color: 'text.secondary' }}>
        <SyncOutlinedIcon aria-hidden />
        <Typography variant="body2">Connecting to the draft API…</Typography>
      </Stack>
    );
  }
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="error" icon={<CloudOffOutlinedIcon />} role="alert">
        <AlertTitle>Draft API not reachable</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          Start the draft API in the repo root, then this page reconnects by itself (it retries every{' '}
          {pollSeconds} s).
        </Typography>
        <Box
          component="code"
          sx={{
            display: 'block',
            px: 1.5,
            py: 1,
            mb: 1.5,
            borderRadius: 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 15,
            overflowWrap: 'anywhere',
          }}
        >
          make draft-api
        </Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: 'text.secondary' }}>
          It listens on 127.0.0.1:8765; the app reaches it through /api.
        </Typography>
        {onRetry && (
          <Button variant="outlined" color="inherit" onClick={onRetry} fullWidth>
            Retry now
          </Button>
        )}
      </Alert>
    </Box>
  );
}
