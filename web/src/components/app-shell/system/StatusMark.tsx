import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { CheckStatus } from '../../../api/system';

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'OK', warn: 'Warning', error: 'Error' };
const COLOR: Record<CheckStatus, string> = { ok: 'success.main', warn: 'warning.main', error: 'error.main' };

/** Status icon in its status color, plus the label in ink: never color alone. */
export function StatusMark({ status, hideLabel }: { status: CheckStatus; hideLabel?: boolean }) {
  const Icon = status === 'ok' ? CheckCircleOutlinedIcon : status === 'warn' ? WarningAmberOutlinedIcon : ErrorOutlinedIcon;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      <Icon sx={{ fontSize: 20, color: COLOR[status] }} aria-hidden={!hideLabel} aria-label={hideLabel ? STATUS_LABEL[status] : undefined} />
      {!hideLabel && (
        <Typography variant="caption" component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {STATUS_LABEL[status]}
        </Typography>
      )}
    </Box>
  );
}
