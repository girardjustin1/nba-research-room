import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import type { LineupDay, LineupResponse, PlayerRef, ReasonTag, SlotDiff } from '../../api/season';
import { buildLineupGrid, cellLabel, etClock, ptsDelta, shortDate, whenLabel, type GridCell } from '../foundations/seasonFormat';
import { ProvenanceLine } from '../foundations/Confidence';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { StatusChip } from '../foundations/PlayerLine';
import { BuilderTabs, type BuilderView } from './BuilderTabs';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { FOR_ME, useResolvedMode } from '../../theme/viz';

export interface LineupScreenProps {
  lineup: LineupResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenPlayer?: (player: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
  onBuilderView?: (v: BuilderView) => void;
  /** Open the sheet for the first changed cell on mount (stories). */
  openFirstChange?: boolean;
  /** 409 from the engine: an input is missing; the text says the next step. */
  notReady?: string | null;
  /** The API went away; the last data stays with a banner. */
  connectionDown?: boolean;
}

const TAG_LABEL: Record<ReasonTag, string> = {
  games: 'Games',
  matchup: 'Matchup',
  minutes: 'Minutes',
  status: 'Status',
  category: 'Category need',
  eligibility: 'Slot shuffle',
  lock: 'Lock',
};

function gameText(a: SlotDiff['optimal']): string {
  if (!a.game) return 'no game';
  return `${a.game.home ? 'vs' : '@'} ${a.game.opp_abbr}${a.game.tip_at ? ` ${etClock(a.game.tip_at)}` : ''}${a.game.b2b ? ' · B2B' : ''}`;
}

function SlotRow({ s, onOpenPlayer }: { s: SlotDiff; onOpenPlayer?: (p: PlayerRef) => void }) {
  const opt = s.optimal;
  const cur = s.current;
  const content = (
    <Box sx={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 1, alignItems: 'center', width: '100%', minHeight: 44, textAlign: 'left' }}>
      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
        {s.slot}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={[{ fontWeight: s.changed ? 700 : 500 }, !opt.player && { color: 'text.secondary', fontStyle: 'italic' }]}>
          {opt.player?.name ?? 'Leave empty'}
        </Typography>
        <Typography variant="caption" component="p" noWrap sx={{ color: 'text.secondary' }}>
          {opt.player ? gameText(opt) : 'nobody eligible has a game'}
          {s.changed && cur.player ? ` · was ${cur.player.name}${cur.game ? '' : ' (no game)'}` : ''}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {opt.locked && <LockOutlinedIcon fontSize="small" aria-label="Locked" sx={{ color: 'text.secondary' }} />}
        {s.changed && (
          <Chip
            size="small"
            label={s.reason_tags.includes('eligibility') ? 'Shuffle' : 'Change'}
            color={s.reason_tags.includes('eligibility') ? 'default' : 'primary'}
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
  return (
    <Box component="li" sx={{ listStyle: 'none', borderTop: 1, borderColor: 'divider', py: 0.5, '&:first-of-type': { borderTop: 0 } }}>
      {opt.player && onOpenPlayer ? (
        <ButtonBase onClick={() => onOpenPlayer(opt.player!)} sx={{ width: '100%', borderRadius: 1 }} aria-label={`${s.slot}: ${opt.player.name}`}>
          {content}
        </ButtonBase>
      ) : (
        content
      )}
      {s.changed && s.reason && (
        <Box sx={{ pl: '48px', pb: 0.5 }}>
          <Typography variant="body2">{s.reason}</Typography>
          <Stack direction="row" sx={{ gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {s.reason_tags.map((t) => (
              <Chip key={t} size="small" label={TAG_LABEL[t]} variant="outlined" />
            ))}
            {s.delta_p_win != null && (
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {ptsDelta(s.delta_p_win)}
              </Typography>
            )}
          </Stack>
        </Box>
      )}
      {opt.player && opt.player.status.code !== 'healthy' && (
        <Box sx={{ pl: '48px', pb: 0.5 }}>
          <StatusChip player={opt.player} />
        </Box>
      )}
    </Box>
  );
}

function TodayCard({ day, today, onOpenPlayer }: { day: LineupDay; today: string; onOpenPlayer?: (p: PlayerRef) => void }) {
  const changes = day.slots.filter((s) => s.changed).length;
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h2">
            {day.is_today ? 'Today' : day.weekday} · {day.weekday} {shortDate(day.date)}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            {changes === 0 ? 'Your lineup is already optimal' : `${changes} slot change${changes === 1 ? '' : 's'}`} · starts {day.games_started_optimal} of{' '}
            {day.games_available} games (now {day.games_started_current})
          </Typography>
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{day.delta_p_win != null ? ptsDelta(day.delta_p_win) : ''}</Typography>
      </Stack>
      {day.first_lock_at && (
        <Typography variant="caption" component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, color: 'text.secondary' }}>
          <LockOutlinedIcon sx={{ fontSize: 14 }} aria-hidden /> First lock {whenLabel(day.first_lock_at, today)}; each slot locks at its player’s tip.
        </Typography>
      )}
      <Box component="ul" sx={{ m: 0, p: 0, mt: 0.5 }}>
        {day.slots.map((s) => (
          <SlotRow key={`${s.slot}-${s.slot_index}`} s={s} onOpenPlayer={onOpenPlayer} />
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ mt: 1, color: 'text.secondary' }}>
        Bench:{' '}
        {day.bench_optimal.map((b) => `${b.player?.name ?? '—'}${b.game ? ' (has a game)' : ''}`).join(', ') || 'nobody'}
        {day.il.length ? ` · IL: ${day.il.map((b) => b.player?.name).join(', ')}` : ''}
      </Typography>
    </Card>
  );
}

/** ▲ he gains a start vs your current lineup, ▼ he loses one, nothing when unchanged. */
function changeSymbol(c: GridCell): string {
  if (!c.changed) return '';
  return c.state === 'start' ? '▲' : '▼';
}


function sheetFor(cell: GridCell | null | undefined, player: PlayerRef | null | undefined, days: LineupDay[]): SheetContent | null {
  if (!cell || !player) return null;
  const day = days.find((d) => d.date === cell.date);
  const what =
    cell.state === 'start' ? `Start at ${cell.slot}` : cell.state === 'bench' ? 'Bench (he has a game)' : cell.state === 'out' ? 'Out' : cell.state === 'il' ? 'On IL' : 'No game';
  const now =
    cell.currentState === 'start' ? `starting at ${cell.currentSlot}` : cell.currentSlot === 'BN' ? 'on the bench' : cell.currentSlot === 'IL' ? 'on IL' : 'in a slot with no game';
  return {
    title: `${day?.weekday ?? ''} ${shortDate(cell.date)} · ${player.name}`,
    subtitle: cell.opp ?? 'No game',
    effect: cell.changed ? (cell.state === 'start' ? '▲ Gains a start: helps you' : '▼ Loses a start: the optimizer prefers someone else') : null,
    sections: [
      { heading: 'Optimal lineup', lines: [`${what}.`, ...(cell.moved ? [`Moves from ${cell.currentSlot} so every player with a game fits.`] : [])] },
      { heading: 'Your current lineup', lines: [`Has him ${now}.`, cell.changed || cell.moved ? 'Change it in Yahoo before his tip.' : 'No change needed.'] },
      ...(cell.reason ? [{ heading: 'Why', lines: [cell.reason] }] : []),
      ...(day ? [{ heading: 'That day', lines: [`Starts ${day.games_started_optimal} of ${day.games_available} games (now ${day.games_started_current}).`, ...(day.delta_p_win != null ? [`Day’s changes together: ${ptsDelta(day.delta_p_win)} P(win week).`] : [])] }] : []),
    ],
  };
}

/** Rest-of-week grid built from layout: rows = my players, columns = days. Tap a cell for the sheet. */
function WeekGrid({ days, roster, openFirstChange }: { days: LineupDay[]; roster: PlayerRef[]; openFirstChange?: boolean }) {
  const rows = useMemo(() => buildLineupGrid(days, roster), [days, roster]);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(() => {
    if (!openFirstChange) return null;
    for (let r = 0; r < rows.length; r += 1) {
      const c = rows[r]!.cells.findIndex((x) => x.changed);
      if (c >= 0) return { r, c };
    }
    return null;
  });
  const mode = useResolvedMode();
  const fm = FOR_ME[mode];
  const cellStyle = (c: GridCell) => {
    switch (c.state) {
      case 'start':
        return { bgcolor: fm.goodRamp[0], color: inkOn(fm.goodRamp[0]), fontWeight: 700 };
      case 'out':
        return {
          color: 'text.primary',
          fontWeight: 700,
          border: `2px solid ${fm.bad}`,
          backgroundImage: `repeating-linear-gradient(135deg, ${fm.bad}66 0 2px, transparent 2px 7px)`,
        };
      case 'bench':
        return { bgcolor: 'action.hover', color: 'text.secondary' };
      default:
        return { color: 'text.disabled' };
    }
  };
  const cell = sel ? rows[sel.r]?.cells[sel.c] : null;
  const player = sel ? rows[sel.r]?.player : null;
  const cols = days.length;

  return (
    <Box>
      <Box role="grid" aria-label="Lineup by day" sx={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) repeat(${cols}, ${cols > 5 ? 38 : 44}px)`, rowGap: '2px', columnGap: '2px', mt: 1 }}>
        <span />
        {days.map((d) => (
          <Typography key={d.date} variant="caption" role="columnheader" sx={{ textAlign: 'center', fontWeight: 700 }}>
            {d.weekday}
          </Typography>
        ))}
        {rows.map((row, r) => (
          <Box key={row.player.player_id} role="row" sx={{ display: 'contents' }}>
            <Typography role="rowheader" variant="body2" noWrap sx={{ alignSelf: 'center', pr: 0.5, fontWeight: row.changes ? 600 : 400 }}>
              {row.player.name.replace(/^(\S)\S*\s/, '$1. ')}
            </Typography>
            {row.cells.map((c, ci) => (
              <ButtonBase
                key={c.date}
                role="gridcell"
                onClick={() => setSel({ r, c: ci })}
                aria-pressed={sel?.r === r && sel?.c === ci}
                aria-haspopup="dialog"
                aria-label={`${row.player.name}, ${days[ci]?.weekday}: ${cellLabel(c)}${c.changed ? ', change' : ''}`}
                sx={[
                  { height: 44, borderRadius: 1, fontSize: 12, position: 'relative', border: 1, borderColor: 'transparent' },
                  cellStyle(c),
                  c.changed && { boxShadow: `inset 0 0 0 2px ${c.state === 'start' ? fm.good : fm.bad}` },
                  sel?.r === r && sel?.c === ci && { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
                ]}
              >
                {cellLabel(c)}
                {c.changed && (
                  <Box component="span" aria-hidden sx={{ position: 'absolute', top: 1, right: 3, fontSize: 9, fontWeight: 800 }}>
                    {changeSymbol(c)}
                  </Box>
                )}
              </ButtonBase>
            ))}
          </Box>
        ))}
      </Box>
      <DetailSheet open={cell != null && player != null} onClose={() => setSel(null)} content={sheetFor(cell, player, days)} />
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Green = starts with a game (helps you) · BN = bench with a game · – = no game · red hatch = out · ▲ / ▼ = gains / loses a start vs your current lineup. Tap a cell for why.
      </Typography>
    </Box>
  );
}

/**
 * Lineup: today's current vs optimal lineup by slot (with the reason for each change and
 * its effect), then a day-by-day grid for the rest of the week, then the change list. All
 * assignments and reasons come from optimizer.py; the grid only regroups them by player.
 */
export function LineupScreen({ lineup, loading, error, onRetry, onOpenPlayer, onTabChange, onBuilderView, openFirstChange, notReady, connectionDown }: LineupScreenProps) {
  const header = (
    <ScreenHeader
      title="Lineup"
      subtitle={lineup ? `${lineup.week.label}${lineup.week.is_playoffs ? ' · Playoffs' : ''} · ${lineup.days.length} day${lineup.days.length === 1 ? '' : 's'} left` : undefined}
      asOf={lineup?.as_of}
      stale={lineup?.stale}
    />
  );
  let body;
  if (notReady && !lineup)
    body = (
      <EmptyState title="The engine needs one more input">
        {notReady}
        {onRetry && (
          <Box sx={{ mt: 1 }}>
            <Button variant="outlined" onClick={onRetry}>
              Check again
            </Button>
          </Box>
        )}
      </EmptyState>
    );
  else if (error && !lineup) body = <ErrorState message={error} onRetry={onRetry} what="the lineup" />;
  else if (!lineup) body = <LoadingState blocks={[420, 300]} label={loading ? 'Loading the lineup' : 'Loading'} />;
  else {
    const [today, ...rest] = lineup.days;
    const restChanges = rest.flatMap((d) => d.slots.filter((s) => s.changed).map((s) => ({ d, s })));
    const infeasible = lineup.optimizer.status === 'infeasible';
    body = (
      <Stack spacing={1.5}>
        {lineup.stale && <StaleBanner reason={lineup.stale_reason} asOf={lineup.as_of} />}
        {connectionDown && (
          <Alert severity="error" role="alert">
            The API is not reachable. Showing the last lineup; run <code>make draft-api</code>.
          </Alert>
        )}
        {!infeasible && lineup.optimizer.message && <Alert severity="info">{lineup.optimizer.message}</Alert>}
        {infeasible && (
          <Alert severity="error">
            <AlertTitle>The optimizer found no legal lineup</AlertTitle>
            {lineup.optimizer.message}
          </Alert>
        )}
        {lineup.week.is_last_day && <Alert severity="info">Last day: only today’s lineup is left to set.</Alert>}
        {today && <TodayCard day={today} today={lineup.week.today} onOpenPlayer={onOpenPlayer} />}
        {rest.length > 0 && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2">
              Rest of the week
            </Typography>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
              {restChanges.length ? `${restChanges.length} changes from your current lineup` : 'No changes needed after today'}
            </Typography>
            <WeekGrid days={rest} roster={lineup.roster} openFirstChange={openFirstChange} />
          </Card>
        )}
        {restChanges.length > 0 && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2">
              Changes by day
            </Typography>
            {rest
              .filter((d) => d.slots.some((s) => s.changed))
              .map((d) => (
                <Box key={d.date} sx={{ mt: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {d.weekday} {shortDate(d.date)}
                    {d.delta_p_win != null ? ` · ${ptsDelta(d.delta_p_win)}` : ''}
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {d.slots
                      .filter((s) => s.changed)
                      .map((s) => (
                        <Typography component="li" variant="body2" key={`${s.slot}-${s.slot_index}`} sx={{ color: 'text.secondary' }}>
                          {s.slot}: {s.optimal.player?.name ?? 'leave empty'}
                          {s.reason ? ` — ${s.reason}` : ''}
                        </Typography>
                      ))}
                  </Box>
                </Box>
              ))}
          </Card>
        )}
        {!infeasible && lineup.days.every((d) => d.slots.every((s) => !s.changed)) && (
          <EmptyState title="Your lineup is already optimal">No slot change raises P(win week) for the rest of the week.</EmptyState>
        )}
        <ProvenanceLine provenance={lineup.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="builder" onTabChange={onTabChange} header={header}>
      <BuilderTabs value="lineup" onChange={onBuilderView} />
      {body}
    </SeasonShell>
  );
}
