import Alert from '@mui/material/Alert';
import type { ApiError } from '../../api/client';

export interface EndpointNoticeProps {
  error: ApiError | null;
  /** e.g. "GET /draft/teams" */
  endpoint: string;
  /** What the user loses while it is missing. */
  what: string;
}

/** Shown when an optional endpoint fails: a 404 means the running API predates it. */
export function EndpointNotice({ error, endpoint, what }: EndpointNoticeProps) {
  if (!error) return null;
  return (
    <Alert severity={error.isNotFound ? 'info' : 'error'} variant="outlined" sx={{ py: 0 }}>
      {error.isNotFound
        ? `${what} needs the updated draft API (${endpoint} is not there yet). Restart make draft-api after updating.`
        : `${what} failed to load: ${error.message}`}
    </Alert>
  );
}
