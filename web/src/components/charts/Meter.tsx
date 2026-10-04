import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useVizColors } from '../../theme/viz';
import { pct } from '../../lib/format';

export interface MeterProps {
  /** Probability 0..1 from the engine; null renders an empty track and "—". */
  value: number | null;
  label: string;
  /** Optional detail after the label, e.g. "pick 33". */
  detail?: string;
}

/**
 * A single ratio on a same-ramp track (dataviz "meter"). The value is printed as text
 * beside the bar, so nothing depends on reading the fill. Thin (6px) with rounded ends.
 */
export function Meter({ value, label, detail }: MeterProps) {
  const viz = useVizColors();
  const width = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <Box
      role="meter"
      aria-label={detail ? `${label}, ${detail}` : label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(value * 100)}
      aria-valuetext={pct(value)}
      sx={{ minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
          {label}
          {detail ? ` ${detail}` : ''}
        </Typography>
        <Typography variant="body2" className="tabular" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {pct(value)}
        </Typography>
      </Box>
      <Box sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: viz.meterTrack, overflow: 'hidden' }}>
        <Box sx={{ width: `${width}%`, height: '100%', borderRadius: 3, bgcolor: viz.meterFill }} />
      </Box>
    </Box>
  );
}
