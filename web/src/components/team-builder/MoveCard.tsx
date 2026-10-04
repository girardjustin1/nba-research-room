import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import type { Acquisitions, IsoDate, Move, PlayerRef, SeasonCategory } from '../../api/season';
import { pct } from '../../lib/format';
import { MOVE_KIND_LABEL, catDeltaLine, deadlineLabel, moveTitle, ptsDelta, signedNum, weekdayOf } from '../foundations/seasonFormat';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { PlayerLine, StatusChip } from '../foundations/PlayerLine';
import { PlayableStrip } from './PlayableStrip';

export interface MoveCardProps {
  move: Move;
  today: IsoDate;
  categories: SeasonCategory[];
  acquisitions: Acquisitions;
  onOpenPlayer?: (player: PlayerRef) => void;
  onCompare?: (move: Move) => void;
  /** Hide the expandable details (for the This Week summary). */
  compact?: boolean;
  /** Used acquisitions before this move, for "uses acquisition 3 of 4". */
  acquisitionIndex?: number;
}

/**
 * One recommended move: kind (ADD / DROP, START, BENCH) as a word, never a color; the
 * players; its effect on P(win week) with the engine's band; the categories it moves; the
 * engine's reason; confidence; and the deadline in league time.
 */
export function MoveCard({ move, today, categories, acquisitions, onOpenPlayer, onCompare, compact, acquisitionIndex }: MoveCardProps) {
  const [open, setOpen] = useState(false);
  const d = move.delta_p_win;
  const detailsId = `move-${move.move_id}`;
  const counterpartLabel = move.kind === 'add_drop' ? 'Drop' : move.kind === 'start' ? 'Sits' : 'Starts';
  const days = move.dates.map(weekdayOf).join(', ');

  return (
    <Card component="li" sx={{ listStyle: 'none', p: 1.5 }} aria-label={`Move ${move.rank}: ${moveTitle(move)}`}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography className="tabular" sx={{ fontWeight: 700, color: 'text.secondary', width: 18 }}>
          {move.rank}
        </Typography>
        <Chip size="small" label={MOVE_KIND_LABEL[move.kind]} variant="outlined" sx={{ fontWeight: 700, letterSpacing: '0.04em' }} />
        <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', minWidth: 0 }}>
          <ScheduleOutlinedIcon sx={{ fontSize: 15 }} aria-hidden />
          {deadlineLabel(move.deadline, today)}
        </Typography>
      </Stack>

      <Typography variant="subtitle1" component="h3" sx={{ mt: 0.75, lineHeight: 1.3 }}>
        {moveTitle(move)}
        {move.slot ? ` at ${move.slot}` : ''}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700 }}>{ptsDelta(d.mean)}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          P(win week) → {pct(move.p_win_after)} · 80% band {ptsDelta(d.lo)} to {ptsDelta(d.hi)}
        </Typography>
      </Box>
      {d.lo < 0 && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
          The band crosses zero: this move could also cost you a little.
        </Typography>
      )}
      <Typography variant="body2" className="tabular" sx={{ mt: 0.5, fontWeight: 600 }}>
        {catDeltaLine(move.cat_deltas, categories, 4)}
        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
          {' '}
          · cats {signedNum(move.delta_expected_cats, 2)}
        </Box>
      </Typography>

      <Typography variant="body2" sx={{ mt: 1 }}>
        {move.reason}
      </Typography>

      {move.playable && !compact && (
        <Box sx={{ mt: 1.25 }}>
          <PlayableStrip
            playable={move.playable}
            addName={move.player.name}
            dropName={move.counterpart?.name ?? null}
            acquisitions={acquisitions}
          />
        </Box>
      )}

      <Box sx={{ mt: 1 }}>
        <PlayerLine
          player={move.player}
          prefix={move.kind === 'add_drop' ? '+' : undefined}
          detail={days}
          onOpen={onOpenPlayer}
          trailing={<StatusChip player={move.player} />}
        />
        {move.counterpart && (
          <PlayerLine
            player={move.counterpart}
            prefix={move.kind === 'add_drop' ? '−' : undefined}
            detail={counterpartLabel}
            onOpen={onOpenPlayer}
            trailing={<StatusChip player={move.counterpart} />}
          />
        )}
      </Box>

      <Stack direction="row" sx={{ gap: 0.75, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <ConfidenceChip confidence={move.confidence} />
        {move.uses_acquisition && (
          <Chip
            size="small"
            variant="outlined"
            label={`Uses acquisition ${(acquisitionIndex ?? acquisitions.used) + 1} of ${acquisitions.max}`}
          />
        )}
      </Stack>
      <MissingInputs confidence={move.confidence} />

      {!compact && (
        <>
          <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
            <Button
              color="inherit"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={detailsId}
              endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
              sx={{ color: 'text.secondary' }}
              disabled={move.details.length === 0}
            >
              Details
            </Button>
            {onCompare && move.counterpart && (
              <Button variant="outlined" fullWidth onClick={() => onCompare(move)}>
                Compare {move.player.name.split(' ').slice(-1)[0]} vs {move.counterpart.name.split(' ').slice(-1)[0]}
              </Button>
            )}
          </Stack>
          <Collapse in={open} id={detailsId}>
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, color: 'text.secondary' }}>
              {move.details.map((t) => (
                <Typography component="li" variant="body2" key={t} sx={{ mb: 0.25 }}>
                  {t}
                </Typography>
              ))}
            </Box>
            <ProvenanceLine provenance={move.provenance} />
          </Collapse>
        </>
      )}
    </Card>
  );
}
