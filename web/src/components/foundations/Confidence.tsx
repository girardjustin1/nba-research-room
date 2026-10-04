import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import RemoveCircleOutlinedIcon from '@mui/icons-material/RemoveCircleOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import type { Confidence, Provenance } from '../../api/season';
import { pct } from '../../lib/format';
import { etClock, etDate, weekdayOf } from './seasonFormat';

const LEVEL = {
  high: { label: 'High confidence', icon: <VerifiedOutlinedIcon /> },
  medium: { label: 'Medium confidence', icon: <HelpOutlinedIcon /> },
  low: { label: 'Low confidence', icon: <ReportProblemOutlinedIcon /> },
  none: { label: 'No estimate', icon: <RemoveCircleOutlinedIcon /> },
} as const;

/** Confidence level as icon + words (never color alone). The engine's score is shown when it has one. */
export function ConfidenceChip({ confidence, compact = false }: { confidence: Confidence; compact?: boolean }) {
  const l = LEVEL[confidence.level];
  const label = compact ? l.label.replace(' confidence', '') : l.label;
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={l.icon}
      label={confidence.score != null && !compact ? `${label} · ${pct(confidence.score)}` : label}
      sx={[
        { maxWidth: '100%' },
        confidence.level === 'low' && { borderColor: 'warning.main' },
        confidence.level === 'none' && { borderStyle: 'dashed' },
      ]}
    />
  );
}

/** What the engine did not have. Always visible when non-empty: it is why confidence dropped. */
export function MissingInputs({ confidence }: { confidence: Confidence }) {
  if (!confidence.missing.length) return null;
  return (
    <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 0, listStyle: 'none' }} aria-label="Missing inputs">
      {confidence.missing.map((m) => (
        <Typography component="li" variant="caption" key={m.key} sx={{ display: 'flex', gap: 0.5, color: 'text.secondary', mb: 0.25 }}>
          <ReportProblemOutlinedIcon sx={{ fontSize: 14, mt: '2px', color: 'warning.dark' }} aria-hidden />
          <span>
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              Missing:
            </Box>{' '}
            {m.label}
            {m.effect ? `. ${m.effect}.` : '.'}
          </span>
        </Typography>
      ))}
    </Box>
  );
}

const MODULE_LABEL: Record<Provenance['module'], string> = {
  projections: 'Projections',
  simulate: 'Simulation',
  optimizer: 'Optimizer',
  overrides: 'Status overrides',
  x_feed: 'X feed',
  kalshi: 'Kalshi',
  rundown: 'Sportsbooks',
  bdl: 'BallDontLie',
  yahoo: 'Yahoo',
  schedule: 'Schedule',
  features: 'Features',
  explain: 'SHAP',
  backtest: 'Backtest',
};

/** "Simulation · Monte Carlo, 5,000 draws · Wed 5:42 pm". */
export function ProvenanceLine({ provenance }: { provenance: Provenance[] }) {
  if (!provenance.length) return null;
  return (
    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
      Source:{' '}
      {provenance
        .map((p) => `${MODULE_LABEL[p.module]}${p.note ? ` (${p.note})` : ''}, ${p.as_of ? `${weekdayOf(etDate(p.as_of))} ${etClock(p.as_of)}` : 'time unknown'}`)
        .join(' · ')}
    </Typography>
  );
}
