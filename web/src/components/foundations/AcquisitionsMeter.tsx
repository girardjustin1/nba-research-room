import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Acquisitions } from '../../api/season';
import { weekdayOf } from './seasonFormat';

/**
 * Acquisitions used this week as x / 4 pips (layout, not a chart): filled = used,
 * outlined = left. At the cap it says so in words with a warning.
 */
export function AcquisitionsMeter({ acquisitions, compact = false }: { acquisitions: Acquisitions; compact?: boolean }) {
  const { used, max, pending, resets_on } = acquisitions;
  const left = Math.max(0, max - used);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">
            Acquisitions
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            {used} of {max} used · {left} left · resets {weekdayOf(resets_on)}
            {pending ? ` · ${pending} pending claim${pending === 1 ? '' : 's'}` : ''}
          </Typography>
        </Box>
        <Box
          role="meter"
          aria-label="Acquisitions used"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
          aria-valuetext={`${used} of ${max} used`}
          sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}
        >
          {Array.from({ length: max }, (_, i) => (
            <Box
              key={i}
              sx={[
                { width: 18, height: 18, borderRadius: '50%', border: 2, borderColor: 'primary.main' },
                i < used && { bgcolor: 'primary.main' },
              ]}
            />
          ))}
        </Box>
      </Box>
      {left === 0 && !compact && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          No acquisitions left this week. Add/drop moves are hidden until {weekdayOf(resets_on)}; start/bench moves still apply.
        </Alert>
      )}
      {left === 1 && !compact && (
        <Typography variant="caption" component="p" sx={{ mt: 0.75, color: 'warning.dark', fontWeight: 600 }}>
          One acquisition left: spend it on the move with the biggest gain.
        </Typography>
      )}
    </Box>
  );
}
