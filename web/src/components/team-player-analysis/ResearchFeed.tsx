import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import DataObjectOutlinedIcon from '@mui/icons-material/DataObjectOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ModelTrainingOutlinedIcon from '@mui/icons-material/ModelTrainingOutlined';
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { FeedItem, FeedResponse, Impact, JobHealth, PlayerRef, SeasonCategory } from '../../api/season';
import { pct } from '../../lib/format';
import { forMeColor, forMeSymbol, forMeWord, useResolvedMode } from '../../theme/viz';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { PlayerLine, StatusChip } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { TIER_LABEL, ago, catDeltaLine, countByKind, etClock, filterFeed, ptsDelta, signedNum, until, type FeedFilter } from '../foundations/seasonFormat';

export interface ResearchFeedProps {
  feed: FeedResponse | null;
  categories: SeasonCategory[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenPlayer?: (p: PlayerRef) => void;
  onOpenMove?: (moveId: string) => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialFilter?: FeedFilter;
  initialJobsOpen?: boolean;
}

const KIND = {
  news: { label: 'News', icon: <NewspaperOutlinedIcon fontSize="small" /> },
  market: { label: 'Market', icon: <ShowChartOutlinedIcon fontSize="small" /> },
  model: { label: 'Model', icon: <ModelTrainingOutlinedIcon fontSize="small" /> },
  data: { label: 'Data', icon: <DataObjectOutlinedIcon fontSize="small" /> },
} as const;

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'news', label: 'News' },
  { key: 'market', label: 'Markets' },
  { key: 'model', label: 'Models' },
  { key: 'data', label: 'Data' },
];

function StatusWord({ status }: { status: 'ok' | 'partial' | 'failed' | 'never' }) {
  const map = {
    ok: { icon: <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />, label: 'OK', color: 'success.dark' },
    partial: { icon: <WarningAmberOutlinedIcon sx={{ fontSize: 15 }} />, label: 'Partial', color: 'warning.dark' },
    failed: { icon: <ErrorOutlineIcon sx={{ fontSize: 15 }} />, label: 'Failed', color: 'error.main' },
    never: { icon: <ErrorOutlineIcon sx={{ fontSize: 15 }} />, label: 'Never ran', color: 'text.secondary' },
  }[status];
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: map.color, fontWeight: 600 }}>
      {map.icon}
      {map.label}
    </Box>
  );
}

/** Compact job health: one summary line, what is running (progress), the rest behind a toggle. */
function JobHealthCard({ feed, initialOpen }: { feed: FeedResponse; initialOpen?: boolean }) {
  const [open, setOpen] = useState(!!initialOpen);
  const running = feed.jobs.filter((j) => j.running);
  const failing = feed.jobs.filter((j) => j.last_status === 'failed');
  const stale = feed.jobs.filter((j) => j.stale);
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h2">
            Background jobs
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: failing.length ? 'error.main' : 'text.secondary', fontWeight: failing.length ? 600 : 400 }}>
            {feed.jobs.length} jobs · {running.length} running · {failing.length} failing{stale.length ? ` · ${stale.length} stale` : ''} · X reads {feed.x_budget.used}/{feed.x_budget.limit}
          </Typography>
        </Box>
        <Button color="inherit" onClick={() => setOpen((o) => !o)} aria-expanded={open} sx={{ color: 'text.secondary', mr: -1 }} endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />}>
          {open ? 'Hide' : 'All'}
        </Button>
      </Stack>
      {running.map((j) => (
        <Box key={j.job} sx={{ mt: 1 }}>
          <Typography variant="caption" component="p" className="tabular" sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {j.label}: running{j.started_at ? ` since ${etClock(j.started_at)}` : ''}
            </span>
            {j.progress && (
              <span>
                {j.progress.done}/{j.progress.total} {j.progress.unit}
              </span>
            )}
          </Typography>
          <LinearProgress
            variant={j.progress ? 'determinate' : 'indeterminate'}
            value={j.progress ? (j.progress.done / j.progress.total) * 100 : undefined}
            aria-label={`${j.label} progress`}
            sx={{ height: 4, borderRadius: 2, mt: 0.25 }}
          />
        </Box>
      ))}
      <Collapse in={open}>
        <Box component="ul" sx={{ m: 0, p: 0, mt: 1, listStyle: 'none' }}>
          {feed.jobs.map((j: JobHealth) => (
            <Box component="li" key={j.job} sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {j.label}
                  {j.stale ? ' · stale' : ''}
                </Typography>
                <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
                  Last {j.last_run_at ? `${etClock(j.last_run_at)} (${ago(j.last_run_at, feed.as_of)})` : 'never'} · next{' '}
                  {j.next_run_at ? `${etClock(j.next_run_at)} (${until(j.next_run_at, feed.as_of)})` : 'on demand'}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ alignSelf: 'center' }}>
                <StatusWord status={j.last_status} />
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Card>
  );
}

function ImpactBox({ impact, categories, onOpenMove }: { impact: Impact; categories: SeasonCategory[]; onOpenMove?: (id: string) => void }) {
  const mode = useResolvedMode();
  const c = forMeColor(impact.delta_p_win, { min: -0.06, max: 0.06, deadband: 0.002 }, mode);
  return (
    <Box sx={{ mt: 1, pl: 1.25, py: 0.75, pr: 1, borderLeft: `4px solid ${c}`, bgcolor: 'action.hover', borderRadius: '0 8px 8px 0' }}>
      <Typography variant="overline" component="p" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
        Impact on your week
      </Typography>
      <Typography variant="body2" className="tabular" sx={{ fontWeight: 700 }}>
        {impact.delta_p_win == null ? 'P(win week): not recomputed' : `${forMeSymbol(impact.delta_p_win, 0.002)} P(win week) ${ptsDelta(impact.delta_p_win)} · ${forMeWord(impact.delta_p_win, 0.002)}`}
      </Typography>
      {impact.cat_deltas.length > 0 && (
        <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
          {catDeltaLine(impact.cat_deltas, categories, 3)} (pts of P(win category))
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 0.25 }}>
        {impact.summary}
      </Typography>
      {impact.suggestion && (
        <Typography variant="body2" sx={{ mt: 0.25 }}>
          <strong>Suggested:</strong> {impact.suggestion}
        </Typography>
      )}
      <Stack direction="row" sx={{ gap: 0.75, mt: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <ConfidenceChip confidence={impact.confidence} compact />
        {impact.move_id && onOpenMove && (
          <Button size="small" variant="outlined" onClick={() => onOpenMove(impact.move_id!)} sx={{ minHeight: 36 }}>
            Open the move
          </Button>
        )}
      </Stack>
      <MissingInputs confidence={impact.confidence} />
    </Box>
  );
}

function ItemBody({ item, onOpenPlayer }: { item: FeedItem; onOpenPlayer?: (p: PlayerRef) => void }) {
  switch (item.kind) {
    case 'news':
      return (
        <>
          <PlayerLine player={item.player} size={30} onOpen={onOpenPlayer} detail={item.player.owner === 'mine' ? 'your player' : item.player.owner === 'opponent' ? 'opponent’s player' : 'free agent'} />
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
            <StatusChip player={item.player} showHealthy />
            {item.minutes_cap != null && <Chip size="small" variant="outlined" label={`Minutes cap ${item.minutes_cap}`} />}
            {item.starting != null && <Chip size="small" variant="outlined" label={item.starting ? 'Starting' : 'Not starting'} />}
          </Stack>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {item.source.handle} · {item.source.tier ? TIER_LABEL[item.source.tier] : item.source.display_name}
            {item.corroborated_by.length ? ` · confirmed by ${item.corroborated_by.length} more` : ' · single source'} · parse confidence {pct(item.parse_confidence)}
          </Typography>
        </>
      );
    case 'market':
      return (
        <>
          <PlayerLine player={item.player} size={30} onOpen={onOpenPlayer} />
          <Typography variant="body2" className="tabular" sx={{ mt: 0.25 }}>
            {item.venue === 'kalshi' ? 'Kalshi' : item.book}: {item.line_before ?? '—'} → <strong>{item.line_after}</strong> · market mean{' '}
            {item.implied_mean_after ?? '—'} vs ours {item.ours.mean} ± {item.ours.sd}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            {item.liquid ? `Liquid${item.volume != null ? `, volume ${item.volume.toLocaleString('en-US')}` : ''}` : 'Illiquid: treated as missing'}
          </Typography>
        </>
      );
    case 'model':
      return (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {item.summary}
          </Typography>
          {item.scoreboard && (
            <Box component="table" sx={{ width: '100%', mt: 0.75, borderCollapse: 'collapse', fontSize: 13 }} aria-label="Minutes model scoreboard">
              <thead>
                <tr>
                  {['Model', 'MAE', 'vs EWMA', 'Gate'].map((h, i) => (
                    <Box component="th" key={h} sx={{ textAlign: i ? 'right' : 'left', fontWeight: 600, color: 'text.secondary', pb: 0.25 }}>
                      {h}
                    </Box>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.scoreboard.map((r) => (
                  <tr key={r.model}>
                    <Box component="td" sx={{ py: 0.25 }}>
                      {r.model}
                    </Box>
                    <Box component="td" className="tabular" sx={{ textAlign: 'right' }}>
                      {r.mae.toFixed(2)}
                    </Box>
                    <Box component="td" className="tabular" sx={{ textAlign: 'right' }}>
                      {r.model === 'EWMA baseline' ? 'baseline' : `${forMeSymbol(r.rel_improvement)} ${signedNum(r.rel_improvement * 100)}%`}
                    </Box>
                    <Box component="td" sx={{ textAlign: 'right' }}>
                      {r.gated_on ? 'on' : 'off'}
                    </Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          )}
        </>
      );
    case 'data':
      return (
        <Typography variant="body2" className="tabular" sx={{ color: 'text.secondary' }}>
          <StatusWord status={item.status} /> · {item.rows != null ? `${item.rows.toLocaleString('en-US')} rows` : 'no rows'}
          {item.duration_ms != null ? ` · ${(item.duration_ms / 1000).toFixed(1)} s` : ''}
          {item.message ? ` · ${item.message}` : ''}
        </Typography>
      );
  }
}

/**
 * Research feed: what the engine is doing and has learned in the background (data syncs,
 * model runs, news parsed from X with source tier, market moves), each with its IMPACT on
 * my week when it has one. Job health is one compact card; running jobs show progress.
 */
export function ResearchFeed(props: ResearchFeedProps) {
  const { feed, categories, loading, error, onRetry, onOpenPlayer, onOpenMove, onTabChange } = props;
  const [filter, setFilter] = useState<FeedFilter>(props.initialFilter ?? 'all');
  const items = useMemo(() => (feed ? filterFeed(feed.items, filter) : []), [feed, filter]);
  const counts = feed ? countByKind(feed.items) : null;

  const header = <ScreenHeader title="Research" subtitle="What the engine is doing in the background" asOf={feed?.as_of} stale={feed?.stale} />;
  let body;
  if (error && !feed) body = <ErrorState message={error} onRetry={onRetry} what="the research feed" />;
  else if (!feed) body = <LoadingState blocks={[90, 44, 180, 180, 140]} label={loading ? 'Loading the feed' : 'Loading'} />;
  else
    body = (
      <Stack spacing={1.5}>
        {feed.stale && <StaleBanner reason={feed.stale_reason} asOf={feed.as_of} />}
        <JobHealthCard feed={feed} initialOpen={props.initialJobsOpen} />
        <Box role="group" aria-label="Filter the feed" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={`${f.label} ${counts?.[f.key] ?? 0}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              color={filter === f.key ? 'primary' : 'default'}
              variant={filter === f.key ? 'filled' : 'outlined'}
              sx={{ height: 40, borderRadius: 20 }}
            />
          ))}
        </Box>
        {items.length === 0 ? (
          <EmptyState title={feed.items.length ? 'Nothing of this kind yet' : 'Quiet so far'}>
            {feed.items.length ? 'Try another filter.' : 'No syncs, model runs, news or market moves since the last nightly run.'}
          </EmptyState>
        ) : (
          <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
            {items.map((item) => (
              <Card component="li" key={item.id} sx={{ listStyle: 'none', p: 1.5 }} aria-label={item.title}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
                  {KIND[item.kind].icon}
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {KIND[item.kind].label}
                  </Typography>
                  <Typography variant="caption" className="tabular">
                    · {etClock(item.at)} · {ago(item.at, feed.as_of)}
                  </Typography>
                  {item.affects_matchup && (
                    <Chip size="small" label="Your matchup" variant="outlined" sx={{ ml: 'auto' }} />
                  )}
                </Stack>
                <Typography variant="subtitle2" component="h3" sx={{ mt: 0.5 }}>
                  {item.title}
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <ItemBody item={item} onOpenPlayer={onOpenPlayer} />
                </Box>
                {item.impact && <ImpactBox impact={item.impact} categories={categories} onOpenMove={onOpenMove} />}
              </Card>
            ))}
          </Stack>
        )}
        {feed.next_cursor && (
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            Older items load as you scroll.
          </Typography>
        )}
        <ProvenanceLine provenance={feed.provenance} />
      </Stack>
    );
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
