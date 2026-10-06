import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { LiveBlock, LiveNews, LiveScoreboardResponse } from '../../../api/system';
import { fixed, pct, signed } from '../../../lib/format';
import { shortDateTime } from '../../../lib/time';
import { shortDate } from '../../foundations/seasonFormat';
import { useVizColors } from '../../../theme/viz';
import { Calibration } from './ModelsView';

export type LiveWindow = 'season' | 'last_7_days';

export interface LiveViewProps {
  scoreboard: LiveScoreboardResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  initialWindow?: LiveWindow;
}

const STAT_LABEL: Record<string, string> = {
  minutes: 'MIN', pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'ST', blk: 'BLK', fg3m: '3PTM', tov: 'TO',
  fga: 'FGA', fgm: 'FGM', fta: 'FTA', ftm: 'FTM',
};
const SOURCE_LABEL: Record<string, string> = { nba_report: 'NBA injury report', x: 'X posts', bdl: 'BallDontLie list' };
const SOURCE_ORDER = ['nba_report', 'x', 'bdl'];
const statLabel = (s: string) => STAT_LABEL[s] ?? s.toUpperCase();
const count = (n: number) => n.toLocaleString('en-US');

/** How often listed players played (fill) against the P(plays) the engine assumes (mark). */
function RateMeter({ row }: { row: LiveNews }) {
  const viz = useVizColors();
  const v = row.played_rate == null ? 0 : Math.max(0, Math.min(1, row.played_rate)) * 100;
  return (
    <Box sx={{ position: 'relative', mt: 0.5 }}>
      <LinearProgress
        variant="determinate"
        value={v}
        aria-label={`${row.status}: share who played`}
        aria-valuetext={`played ${pct(row.played_rate)}${row.assumed == null ? '' : `, assumed ${pct(row.assumed)}`}`}
        sx={{ height: 6, borderRadius: 3, bgcolor: viz.meterTrack, '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: viz.meterFill } }}
      />
      {row.assumed != null && (
        <Box aria-hidden sx={{ position: 'absolute', left: `${row.assumed * 100}%`, top: -3, bottom: -3, width: 2, bgcolor: 'text.primary', borderRadius: 1 }} />
      )}
    </Box>
  );
}

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <Card sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {caption && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
          {caption}
        </Typography>
      )}
      <Box component="ul" sx={{ m: 0, p: 0, mt: 0.5 }}>
        {children}
      </Box>
    </Card>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', py: 1, borderTop: 1, borderColor: 'divider' }}>
      {children}
    </Box>
  );
}

function Stats({ block }: { block: LiveBlock }) {
  return (
    <Section title="Projections by stat" caption="Average miss per player-game (a game he sat counts 0). The tall mark is the 80% target.">
      {block.stats.map((r) => (
        <Row key={r.stat}>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, width: 48 }}>
              {statLabel(r.stat)}
            </Typography>
            <Typography variant="caption" className="tabular" sx={{ flex: 1, color: 'text.secondary' }}>
              off by {fixed(r.mae, 2)} · lean {signed(r.bias, 2)} · n {count(r.n)}
            </Typography>
          </Stack>
          <Calibration coverage={r.coverage_80} />
        </Row>
      ))}
    </Section>
  );
}

function Market({ block }: { block: LiveBlock }) {
  if (!block.market.length) return null;
  return (
    <Section title="Betting market vs our model" caption="Average miss on games where a liquid prop set the projection: the market's number against ours.">
      {block.market.map((r) => {
        const closer = r.market_mae == null || r.model_mae == null ? null : r.market_mae < r.model_mae - 0.005 ? 'market' : r.model_mae < r.market_mae - 0.005 ? 'ours' : 'even';
        return (
          <Row key={r.stat}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, width: 48 }}>
                {statLabel(r.stat)}
              </Typography>
              <Typography variant="caption" className="tabular" sx={{ flex: 1, color: 'text.secondary' }}>
                market {fixed(r.market_mae, 2)} · ours {fixed(r.model_mae, 2)} · n {count(r.n)}
              </Typography>
              {closer && <Chip size="small" variant="outlined" label={closer === 'market' ? 'Market closer' : closer === 'ours' ? 'Ours closer' : 'Even'} />}
            </Stack>
          </Row>
        );
      })}
    </Section>
  );
}

function Availability({ block }: { block: LiveBlock }) {
  if (!block.p_play) return null;
  const { brier, bias } = block.p_play;
  return (
    <Section title="Chance of playing" caption="Brier score: 0 is perfect, 0.25 is a coin flip.">
      <Row>
        <Typography variant="body2" className="tabular">
          Brier {fixed(brier, 3)}
          {bias != null && ` · our chance of playing runs ${Math.abs(bias * 100).toFixed(1)} points too ${bias >= 0 ? 'high' : 'low'}`}
        </Typography>
        {block.ungraded > 0 && (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {count(block.ungraded)} projected player-games had no box score and weren't graded.
          </Typography>
        )}
      </Row>
    </Section>
  );
}

function News({ block }: { block: LiveBlock }) {
  if (!block.news.length) return null;
  const sources = SOURCE_ORDER.filter((s) => block.news.some((r) => r.source === s)).concat(
    [...new Set(block.news.map((r) => r.source))].filter((s) => !SOURCE_ORDER.includes(s)),
  );
  return (
    <Section title="Did listed players play?" caption="How often each source's status came true. The tall mark is the chance of playing we assume.">
      {sources.map((src) => (
        <Box component="li" key={src} sx={{ listStyle: 'none', borderTop: 1, borderColor: 'divider', pt: 1 }}>
          <Typography variant="overline" component="h4" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
            {SOURCE_LABEL[src] ?? src}
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0 }}>
            {block.news
              .filter((r) => r.source === src)
              .map((r) => (
                <Box component="li" key={`${src}-${r.status}`} sx={{ listStyle: 'none', pb: 1 }}>
                  <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 96 }}>
                      {r.status}
                    </Typography>
                    <Typography variant="caption" className="tabular" sx={{ flex: 1, color: 'text.secondary' }}>
                      played {pct(r.played_rate)} of {count(r.listed)}
                      {r.assumed != null && ` · we assume ${pct(r.assumed)}`}
                    </Typography>
                  </Stack>
                  <RateMeter row={r} />
                </Box>
              ))}
          </Box>
        </Box>
      ))}
    </Section>
  );
}

function WeeklyOdds({ block }: { block: LiveBlock }) {
  const w = block.weekly_odds;
  return (
    <Section title="Win-the-week odds" caption="Brier score against the week's result: 0 is perfect, 0.25 is a coin flip.">
      <Row>
        {w ? (
          <Typography variant="body2" className="tabular">
            {w.weeks} {w.weeks === 1 ? 'week' : 'weeks'} · start of the week {fixed(w.brier_first_snapshot, 3)} · every update {fixed(w.brier_all_snapshots, 3)}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Graded once a week finishes and its Yahoo matchup totals are in.
          </Typography>
        )}
      </Row>
    </Section>
  );
}

/**
 * Live scoreboard (GET /system/scoreboard): what the app said before each game against what
 * happened, by stat, for the betting market against our model, for the chance of playing, for
 * each news source's statuses, and for the win-the-week odds. Every number is the engine's.
 */
export function LiveView({ scoreboard: sb, loading, error, onRetry, initialWindow = 'season' }: LiveViewProps) {
  const [win, setWin] = useState<LiveWindow>(initialWindow);

  if (!sb) {
    if (error) {
      return (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Scoreboard unavailable: {error}
        </Alert>
      );
    }
    return (
      <Stack spacing={1} aria-busy={loading ? 'true' : undefined} aria-label="Loading the scoreboard">
        <Skeleton variant="rounded" height={40} />
        <Skeleton variant="rounded" height={280} />
      </Stack>
    );
  }

  if (sb.season.days === 0) {
    return (
      <Card sx={{ p: 2 }}>
        <Typography variant="subtitle2" component="h3">
          Grading starts after opening night
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          The season starts {shortDate(sb.season_start)}. Each night after, every finished game is graded against the last projection made before its tip, and this page fills in.
        </Typography>
      </Card>
    );
  }

  const block = win === 'season' ? sb.season : sb.last_7_days;
  return (
    <Stack spacing={1.5}>
      {error && (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Refresh failed ({error}). Showing the last result.
        </Alert>
      )}
      <Box>
        <Stack direction="row" sx={{ gap: 0.75 }} role="group" aria-label="Window">
          {(['season', 'last_7_days'] as const).map((w) => (
            <Chip
              key={w}
              label={w === 'season' ? 'Season' : 'Last 7 days'}
              color={w === win ? 'primary' : 'default'}
              variant={w === win ? 'filled' : 'outlined'}
              aria-pressed={w === win}
              onClick={() => setWin(w)}
              sx={{ height: 36 }}
            />
          ))}
        </Stack>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
          {block.days} game {block.days === 1 ? 'day' : 'days'} graded
          {win === 'season' ? ` since ${shortDate(sb.season_start)}` : ''}
          {sb.as_of ? ` · as of ${shortDateTime(sb.as_of)}` : ''}
        </Typography>
      </Box>
      <Stats block={block} />
      <Market block={block} />
      <Availability block={block} />
      <News block={block} />
      <WeeklyOdds block={block} />
      {sb.note && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {sb.note}
        </Typography>
      )}
    </Stack>
  );
}
