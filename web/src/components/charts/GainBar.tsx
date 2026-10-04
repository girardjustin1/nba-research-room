import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useVizColors } from '../../theme/viz';
import { signed } from '../../lib/format';

export interface GainBarProps {
  /** Expected-categories gain from the engine (signed). */
  gain: number | null;
  /** Largest |gain| in the visible list, so bars share one scale. */
  scaleMax: number;
}

/**
 * Inline diverging bar for "gain": grows right (blue) for positive, left (red) for negative
 * from a gray zero line. The signed number is always printed; the bar only supports it.
 */
export function GainBar({ gain, scaleMax }: GainBarProps) {
  const viz = useVizColors();
  const max = scaleMax > 0 ? scaleMax : 1;
  const frac = gain == null ? 0 : Math.min(1, Math.abs(gain) / max);
  const positive = (gain ?? 0) >= 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box aria-hidden sx={{ position: 'relative', flex: 1, height: 8, minWidth: 40 }}>
        <Box sx={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: '1px', bgcolor: viz.axis }} />
        <Box
          sx={{
            position: 'absolute',
            top: 1,
            height: 6,
            width: `${frac * 50}%`,
            ...(positive
              ? { left: 'calc(50% + 1px)', borderRadius: '0 3px 3px 0', bgcolor: viz.pos }
              : { right: 'calc(50% + 1px)', borderRadius: '3px 0 0 3px', bgcolor: viz.neg }),
          }}
        />
      </Box>
      <Typography variant="body2" className="tabular" sx={{ fontWeight: 600, minWidth: 44, textAlign: 'right' }}>
        {signed(gain)}
      </Typography>
    </Box>
  );
}
