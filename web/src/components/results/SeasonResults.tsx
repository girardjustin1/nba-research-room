import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { CategoryResult, ResultsResponse, SeasonCategory, WeekResult } from '../../api/season';
import { ordinal, pct } from '../../lib/format';
import { FOR_ME, useResolvedMode, useVizColors } from '../../theme/viz';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { ProvenanceLine } from '../foundations/Confidence';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { catLabel, dateRange, statValue } from '../foundations/seasonFormat';

export interface SeasonResultsProps {
  results: ResultsResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
  /** Open a category sheet on mount (stories): week number + category key. */
  initialOpen?: { week: number; key: CategoryResult['key'] } | null;
}

const RESULT = { won: { sym: '▲', word: 'Won' }, lost: { sym: '▼', word: 'Lost' }, tied: { sym: '●', word: 'Tied' } } as const;

function catSheet(w: WeekResult, c: CategoryResult, cats: SeasonCategory[], punts: string[]): SheetContent {
  const def = cats.find((x) => x.key === c.key);
  const ratio = def?.is_ratio ?? false;
  return {
    title: `${catLabel(c.key, cats)} · ${w.label}`,
    subtitle: `vs ${w.opponent.name} · ${dateRange(w.start, w.end)}`,
    effect: `${RESULT[c.result].sym} ${RESULT[c.result].word}${punts.includes(c.key) ? ' (punted)' : ''}`,
    sections: [
      {
        heading: 'Final',
        lines: [
          `You ${statValue(c.mine, ratio)} · them ${statValue(c.theirs, ratio)}${def && !def.higher_is_better ? ' (fewer wins)' : ''}.`,
          `Margin in your favor: ${c.margin == null ? '—' : `${c.margin > 0 ? '+' : ''}${statValue(c.margin, ratio)}`}.`,
        ],
      },
      { heading: 'Before the week', lines: [`The engine gave you ${pct(c.predicted_p)} to win it.`] },
    ],
  };
}

function WeekCard({ w, cats, punts, onOpen }: { w: WeekResult; cats: SeasonCategory[]; punts: string[]; onOpen: (c: CategoryResult) => void }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const [view, setView] = useState<'tiles' | 'table'>('tiles');
  const won = w.outcome === 'win';
  const oc = w.outcome === 'win' ? fm.good : w.outcome === 'loss' ? fm.bad : fm.neutral;
  return (
    <Card component="li" sx={{ listStyle: 'none', p: 1.5 }} aria-label={`${w.label}: ${w.outcome}`}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">
            {w.label}
            {w.is_playoffs && w.playoff_round ? ` · ${w.playoff_round}` : ''} · {dateRange(w.start, w.end)}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }} noWrap>
            vs {w.opponent.name}
          </Typography>
        </Box>
        <Box sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: oc, color: inkOn(oc), fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
          {won ? '▲ Won' : w.outcome === 'loss' ? '▼ Lost' : '● Tied'} {w.cats_won}–{w.cats_lost}
          {w.cats_tied ? `–${w.cats_tied}` : ''}
        </Box>
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.75 }}>
        {w.summary}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Category results · tap for totals
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'tiles' | 'table' | null) => v && setView(v)} aria-label="Category view">
          <ToggleButton value="tiles" sx={{ px: 1.25 }}>
            Tiles
          </ToggleButton>
          <ToggleButton value="table" sx={{ px: 1.25 }}>
            Table
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {view === 'tiles' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '4px', mt: 0.75 }}>
          {w.categories.map((c) => {
            const bg = c.result === 'won' ? fm.goodRamp[1] : c.result === 'lost' ? fm.badRamp[1] : fm.neutral;
            const punted = punts.includes(c.key);
            return (
              <ButtonBase
                key={c.key}
                onClick={() => onOpen(c)}
                aria-haspopup="dialog"
                aria-label={`${catLabel(c.key, cats)}: ${RESULT[c.result].word}${punted ? ', punted' : ''}`}
                sx={{
                  height: 48,
                  borderRadius: 1.5,
                  flexDirection: 'column',
                  bgcolor: punted ? 'transparent' : bg,
                  color: punted ? 'text.secondary' : inkOn(bg),
                  border: punted ? `1px dashed ${viz.axis}` : 'none',
                }}
              >
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: 'inherit' }}>
                  {catLabel(c.key, cats)}
                </Typography>
                <Typography component="span" aria-hidden sx={{ fontSize: 11, color: 'inherit' }}>
                  {punted ? 'punt' : RESULT[c.result].sym}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      ) : (
        <Table size="small" aria-label={`${w.label} categories`}>
          <TableHead>
            <TableRow>
              {['Cat', 'You', 'Them', 'Result', 'Pre-week'].map((h, i) => (
                <TableCell key={h} align={i ? 'right' : 'left'} sx={{ px: 0.5 }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {w.categories.map((c) => {
              const ratio = cats.find((x) => x.key === c.key)?.is_ratio ?? false;
              return (
                <TableRow key={c.key}>
                  <TableCell sx={{ px: 0.5 }}>{catLabel(c.key, cats)}</TableCell>
                  <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                    {statValue(c.mine, ratio)}
                  </TableCell>
                  <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                    {statValue(c.theirs, ratio)}
                  </TableCell>
                  <TableCell align="right" sx={{ px: 0.5 }}>
                    {RESULT[c.result].sym} {RESULT[c.result].word}
                  </TableCell>
                  <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                    {pct(c.predicted_p)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Results: season record and standings position, then each completed week: the W/L vs
 * that opponent and the nine category results (tiles: green ▲ won, red ▼ lost, gray ●
 * tied; tap for totals and margin; a table view lists every number).
 */
export function SeasonResults({ results: r, loading, error, onRetry, onTabChange, initialOpen = null }: SeasonResultsProps) {
  const [open, setOpen] = useState<{ week: number; key: CategoryResult['key'] } | null>(initialOpen);
  const header = (
    <ScreenHeader
      title="Results"
      subtitle={r ? `${r.record.wins}–${r.record.losses}${r.record.ties ? `–${r.record.ties}` : ''}${r.my_rank ? ` · ${ordinal(r.my_rank)} of ${r.standings.length}` : ''}` : undefined}
      asOf={r?.as_of}
      stale={r?.stale}
    />
  );
  let body;
  if (error && !r) body = <ErrorState message={error} onRetry={onRetry} what="results" />;
  else if (!r) body = <LoadingState blocks={[120, 260, 260, 400]} label={loading ? 'Loading results' : 'Loading'} />;
  else {
    const ow = open ? r.weeks.find((w) => w.week === open.week) : null;
    const oc = ow && open ? ow.categories.find((c) => c.key === open.key) : null;
    body = (
      <Stack spacing={1.5}>
        {r.stale && <StaleBanner reason={r.stale_reason} asOf={r.as_of} />}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Season
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mt: 0.25, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>
              {r.record.wins}–{r.record.losses}
              {r.record.ties ? `–${r.record.ties}` : ''}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {r.my_rank ? `${ordinal(r.my_rank)} of ${r.standings.length} · top ${r.playoff_spots} make the playoffs` : 'No games yet'}
              {r.regular_weeks_left > 0 ? ` · ${r.regular_weeks_left} regular weeks left` : ' · regular season over'}
            </Typography>
          </Box>
        </Card>
        {r.weeks.length === 0 ? (
          <EmptyState title="No completed weeks yet">Week 1 ends Sunday Nov 1. Results and the prediction review appear after it.</EmptyState>
        ) : (
          <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
            {r.weeks.map((w) => (
              <WeekCard key={w.week} w={w} cats={r.categories} punts={r.punts} onOpen={(c) => setOpen({ week: w.week, key: c.key })} />
            ))}
          </Stack>
        )}
        {r.standings.length > 0 && (
          <Card sx={{ p: 0 }}>
            <Typography variant="subtitle2" component="h2" sx={{ px: 1.5, pt: 1.5 }}>
              Standings
            </Typography>
            <Table size="small" aria-label="Standings">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 1.5, pr: 0.5 }}>#</TableCell>
                  <TableCell sx={{ px: 0.5 }}>Team</TableCell>
                  <TableCell align="right" sx={{ px: 0.5 }}>
                    W–L
                  </TableCell>
                  <TableCell align="right" sx={{ pl: 0.5, pr: 1.5 }}>
                    GB
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {r.standings.map((s) => (
                  <TableRow
                    key={s.team.team_id}
                    selected={s.is_me}
                    sx={s.rank === r.playoff_spots ? { '& td': { borderBottom: 2, borderColor: 'text.secondary' } } : undefined}
                  >
                    <TableCell className="tabular" sx={{ pl: 1.5, pr: 0.5 }}>
                      {s.rank}
                    </TableCell>
                    <TableCell sx={{ px: 0.5, fontWeight: s.is_me ? 700 : 400 }}>
                      {s.team.name}
                      {s.is_me && <Chip size="small" label="You" sx={{ ml: 0.75, height: 20 }} />}
                    </TableCell>
                    <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                      {s.wins}–{s.losses}
                      {s.ties ? `–${s.ties}` : ''}
                    </TableCell>
                    <TableCell align="right" className="tabular" sx={{ pl: 0.5, pr: 1.5 }}>
                      {s.games_back == null ? '—' : s.games_back}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 1.5, py: 1 }}>
              The heavier line is the playoff cut (top {r.playoff_spots}).
            </Typography>
          </Card>
        )}
        <ProvenanceLine provenance={r.provenance} />
        <DetailSheet open={!!(ow && oc)} onClose={() => setOpen(null)} content={ow && oc ? catSheet(ow, oc, r.categories, r.punts) : null} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="results" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
