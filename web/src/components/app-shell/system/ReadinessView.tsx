import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { CheckStatus, ReadinessCheck, ReadinessResponse } from '../../../api/system';
import { shortDateTime } from '../../../lib/time';
import { StatusMark } from './StatusMark';

export interface ReadinessViewProps {
  readiness: ReadinessResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const ORDER: CheckStatus[] = ['error', 'warn', 'ok'];
const GROUP: Record<CheckStatus, string> = { error: 'Fix before the draft', warn: 'Works, with lower confidence', ok: 'Ready' };

function countdown(hours: number): string {
  if (hours <= 0) return 'Draft has started';
  if (hours < 1) return `Draft in ${Math.round(hours * 60)} min`;
  if (hours < 48) return `Draft in ${Math.round(hours)} h`;
  return `Draft in ${Math.round(hours / 24)} days`;
}

function Row({ c }: { c: ReadinessCheck }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', py: 1.25, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ pt: 0.25 }}>
          <StatusMark status={c.status} hideLabel />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {c.label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {c.detail}
          </Typography>
          {c.action && (
            <Box sx={{ mt: 0.5, px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, overflowWrap: 'anywhere' }}>
              {c.action}
            </Box>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

/**
 * Draft-night readiness (the same checks as `make doctor`): a countdown and summary, then
 * the checks grouped as must-fix, lower-confidence and ready, each with the action that fixes it.
 */
export function ReadinessView({ readiness: r, loading, error, onRetry }: ReadinessViewProps) {
  if (!r) {
    if (error) {
      return (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Readiness checks unavailable: {error}
        </Alert>
      );
    }
    return (
      <Stack spacing={1} aria-busy={loading ? 'true' : undefined} aria-label="Loading readiness checks">
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={280} />
      </Stack>
    );
  }
  const errors = r.checks.filter((c) => c.status === 'error').length;
  const warns = r.checks.filter((c) => c.status === 'warn').length;
  const summary = errors
    ? `${errors} to fix before the draft`
    : warns
      ? `Ready, ${warns} open item${warns === 1 ? '' : 's'}`
      : 'Ready for the draft';
  return (
    <Stack spacing={1.5}>
      {error && (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Refresh failed ({error}). Showing the last result.
        </Alert>
      )}
      <Card sx={{ p: 1.5 }} role="status">
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          {countdown(r.hours_to_draft)} · {shortDateTime(r.draft_starts_at)}
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <StatusMark status={r.overall} />
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
            {summary}
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Same checks as <Box component="code">make doctor</Box> · as of {shortDateTime(r.as_of)}
        </Typography>
      </Card>
      {ORDER.map((s) => {
        const rows = r.checks.filter((c) => c.status === s);
        if (!rows.length) return null;
        return (
          <Card key={s} sx={{ px: 1.5, pt: 1 }}>
            <Typography variant="overline" component="h3" sx={{ color: 'text.secondary' }}>
              {GROUP[s]} · {rows.length}
            </Typography>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {rows.map((c) => (
                <Row key={c.key} c={c} />
              ))}
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}
