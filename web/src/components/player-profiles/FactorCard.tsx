import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Factor, IsoDate, PushDirection, SeasonCategory } from '../../api/season';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { formatValue } from '../foundations/seasonFormat';
import { FactorDetailView } from './FactorDetails';

const PUSH: Record<PushDirection, string> = { for: '▲ Supports', against: '▼ Against', neutral: '● Neutral', unknown: '? Unknown' };

/**
 * One reason behind the recommendation: the headline number (or a dash when the engine
 * could not compute it), a one-line reading, whether it pushes for or against, the
 * detail view, and where the number came from with what was missing.
 */
export function FactorCard({ factor: f, categories, today }: { factor: Factor; categories: SeasonCategory[]; today: IsoDate }) {
  return (
    <Card id={`factor-${f.kind}`} component="section" sx={{ p: 1.5, scrollMarginTop: 96 }} aria-label={f.title}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" component="h3">
          {f.title}
        </Typography>
        <Chip size="small" variant="outlined" label={PUSH[f.push]} sx={{ fontWeight: 700, flexShrink: 0 }} />
      </Stack>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 24, fontWeight: 600 }}>{formatValue(f.value, f.format)}</Typography>
        {f.value_note && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {f.value_note}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ mt: 0.25, mb: 1 }}>
        {f.reading}
      </Typography>
      <FactorDetailView detail={f.detail} categories={categories} today={today} />
      <Box sx={{ mt: 1 }}>
        <ConfidenceChip confidence={f.confidence} />
      </Box>
      <MissingInputs confidence={f.confidence} />
      <ProvenanceLine provenance={f.provenance} />
    </Card>
  );
}
