import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useVizColors } from '../../../theme/viz';
import { pct } from '../../../lib/format';

export interface MeterProps {
  /** Probability 0..1 from the engine; null renders an empty track and "—". */
  value: number | null;
  label: string;
  /** Optional detail after the label, e.g. "#33". */
  detail?: string;
}

/**
 * A single ratio on a same-ramp track (MUI LinearProgress). The value is printed as text
 * beside the bar, so nothing depends on reading the fill.
 */
export function Meter({ value, label, detail }: MeterProps) {
  const viz = useVizColors();
  const v = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
          {label}
          {detail ? ` ${detail}` : ''}
        </Typography>
        <Typography variant="body2" className="tabular" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {pct(value)}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={v}
        aria-label={detail ? `${label} ${detail}` : label}
        aria-valuetext={pct(value)}
        sx={{
          mt: 0.5,
          height: 6,
          borderRadius: 3,
          bgcolor: viz.meterTrack,
          '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: viz.meterFill },
        }}
      />
    </Box>
  );
}
