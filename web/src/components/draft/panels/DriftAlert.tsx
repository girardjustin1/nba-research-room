import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Typography from '@mui/material/Typography';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { Category } from '../../../api/types';
import { categoryLabel } from '../../../lib/format';

export interface DriftAlertProps {
  /** Category keys from the board's `drift` list. Renders nothing when empty. */
  drift: string[];
  categories: Category[];
}

/**
 * Punt-drift warning: categories you are not punting that your build rarely wins
 * (the engine's threshold, after round 3). Status color + icon + text, never color alone.
 */
export function DriftAlert({ drift, categories }: DriftAlertProps) {
  if (!drift.length) return null;
  const labels = drift.map((k) => categoryLabel(k, categories));
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
  return (
    <Alert severity="warning" icon={<WarningAmberOutlinedIcon />} role="status" aria-live="polite">
      <AlertTitle sx={{ mb: 0.25 }}>Punt drift: {list}</AlertTitle>
      <Typography variant="body2">
        You are not punting {labels.length > 1 ? 'these' : 'this'}, but your build rarely wins{' '}
        {labels.length > 1 ? 'them' : 'it'}. Punt on purpose (My team, punts) or draft to rebalance.
      </Typography>
    </Alert>
  );
}
