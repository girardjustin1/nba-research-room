import type { ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import HistoryToggleOffOutlinedIcon from '@mui/icons-material/HistoryToggleOffOutlined';
import type { IsoDateTime } from '../../api/season';
import { etClock, etDate, weekdayOf } from './seasonFormat';

/** First load: skeleton blocks shaped like the screen's cards. */
export function LoadingState({ blocks = [160, 220, 140], label = 'Loading' }: { blocks?: number[]; label?: string }) {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-label={label}>
      {blocks.map((h, i) => (
        <Skeleton key={i} variant="rounded" height={h} />
      ))}
    </Stack>
  );
}

/** The API answered with an error, or could not be reached. */
export function ErrorState({ message, onRetry, what = 'this screen' }: { message: string; onRetry?: () => void; what?: string }) {
  return (
    <Alert
      severity="error"
      icon={<CloudOffOutlinedIcon />}
      role="alert"
      action={
        onRetry && (
          <Button color="inherit" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      <AlertTitle>Could not load {what}</AlertTitle>
      {message}
    </Alert>
  );
}

/** Server-flagged stale inputs. Numbers still show, labelled with how old they are. */
export function StaleBanner({ reason, asOf }: { reason: string | null; asOf: IsoDateTime }) {
  return (
    <Alert severity="warning" icon={<HistoryToggleOffOutlinedIcon />} sx={{ mb: 1.5 }}>
      <AlertTitle sx={{ mb: 0.25 }}>
        Stale data: as of {weekdayOf(etDate(asOf))} {etClock(asOf)}
      </AlertTitle>
      {reason ?? 'An input is older than its freshness budget.'} Confidence is lower until the next good sync.
    </Alert>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <Alert severity="info" icon={icon}>
      <AlertTitle>{title}</AlertTitle>
      {children && (
        <Typography variant="body2" component="div">
          {children}
        </Typography>
      )}
    </Alert>
  );
}
