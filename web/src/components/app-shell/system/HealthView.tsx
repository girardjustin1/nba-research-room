import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { CheckStatus, HealthCheck, HealthResponse } from '../../../api/system';
import { ageLabel, bytesLabel, hoursBetween, shortDateTime } from '../../../lib/time';
import { StatusMark } from './StatusMark';

export interface HealthViewProps {
  health: HealthResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const ORDER: CheckStatus[] = ['error', 'warn', 'ok'];
const GROUP: Record<CheckStatus, string> = { error: 'Errors', warn: 'Warnings', ok: 'Passing' };

function CheckRow({ c, asOf }: { c: HealthCheck; asOf: string }) {
  const age = hoursBetween(c.last_ok_at, asOf);
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
          <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary' }}>
            Last OK {c.last_ok_at ? ageLabel(age) : 'never'}
            {c.freshness_budget_h != null ? ` · budget ${Math.round(c.freshness_budget_h)} h` : ''}
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
 * Health checks grouped by status (errors, warnings, passing), each with icon + label +
 * detail + next action; then recent jobs and the store's table sizes.
 */
export function HealthView({ health: h, loading, error, onRetry }: HealthViewProps) {
  const [allTables, setAllTables] = useState(false);
  if (!h) {
    if (error) {
      return (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Health checks unavailable: {error}
        </Alert>
      );
    }
    return (
      <Stack spacing={1} aria-busy={loading ? 'true' : undefined} aria-label="Loading health checks">
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={240} />
      </Stack>
    );
  }
  const counts = { error: h.checks.filter((c) => c.status === 'error').length, warn: h.checks.filter((c) => c.status === 'warn').length };
  const summary =
    h.checks.length === 0
      ? 'No checks reported yet'
      : counts.error
        ? `${counts.error} error${counts.error === 1 ? '' : 's'}${counts.warn ? `, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}` : ''}`
        : counts.warn
          ? `${counts.warn} warning${counts.warn === 1 ? '' : 's'}`
          : 'All checks pass';
  const tables = [...h.store.tables].sort((a, b) => b.rows - a.rows);
  return (
    <Stack spacing={1.5}>
      {error && (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Refresh failed ({error}). Showing the last result.
        </Alert>
      )}
      <Card sx={{ p: 1.5 }} role="status">
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <StatusMark status={h.overall} />
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
            {summary}
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          As of {shortDateTime(h.as_of)}
        </Typography>
      </Card>

      {ORDER.map((s) => {
        const rows = h.checks.filter((c) => c.status === s);
        if (!rows.length) return null;
        return (
          <Card key={s} sx={{ px: 1.5, pt: 1 }}>
            <Typography variant="overline" component="h3" sx={{ color: 'text.secondary' }}>
              {GROUP[s]} · {rows.length}
            </Typography>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {rows.map((c) => (
                <CheckRow key={c.key} c={c} asOf={h.as_of} />
              ))}
            </Box>
          </Card>
        );
      })}

      <Card sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
        <Typography variant="overline" component="h3" sx={{ color: 'text.secondary' }}>
          Recent jobs
        </Typography>
        {h.jobs.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', pb: 1 }}>No jobs have run yet.</Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0 }}>
            {h.jobs.map((j, i) => {
              const st: CheckStatus = j.status === 'ok' || j.status === 'success' ? 'ok' : j.status === 'error' || j.status === 'failed' ? 'error' : 'warn';
              return (
                <Stack component="li" key={`${j.source}-${j.job}-${i}`} direction="row" sx={{ listStyle: 'none', gap: 1, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
                  <Box sx={{ pt: 0.25 }}>
                    <StatusMark status={st} hideLabel />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {j.source} · {j.job}
                    </Typography>
                    <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary', display: 'block' }}>
                      {j.status} · {shortDateTime(j.finished_at)}
                      {j.rows != null ? ` · ${j.rows.toLocaleString('en-US')} rows` : ''}
                    </Typography>
                    {j.detail && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                        {j.detail}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Box>
        )}
      </Card>

      <Card sx={{ px: 1.5, pt: 1, pb: 1 }}>
        <Typography variant="overline" component="h3" sx={{ color: 'text.secondary' }}>
          Store · {bytesLabel(h.store.db_bytes)}
        </Typography>
        {tables.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No tables yet.</Typography>
        ) : (
          <>
            <Box component="ul" sx={{ m: 0, p: 0 }} aria-label="Rows per table">
              {(allTables ? tables : tables.slice(0, 8)).map((t) => (
                <Stack component="li" key={t.table} direction="row" sx={{ listStyle: 'none', justifyContent: 'space-between', py: 0.5, gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {t.table}
                  </Typography>
                  <Typography variant="body2" className="tabular" sx={{ fontWeight: 600 }}>
                    {t.rows.toLocaleString('en-US')}
                  </Typography>
                </Stack>
              ))}
            </Box>
            {tables.length > 8 && (
              <Button size="small" onClick={() => setAllTables((v) => !v)} sx={{ mt: 0.5 }}>
                {allTables ? 'Show fewer' : `Show all ${tables.length} tables`}
              </Button>
            )}
          </>
        )}
      </Card>
    </Stack>
  );
}
