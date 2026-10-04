import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { GameCenterMoment, GameCenterResponse, InjuryStatus, LinescoreRow, PlayerRef, SeasonCategory, StrengthRow } from '../../api/season';
import { initials } from '../../lib/assets';
import { pct } from '../../lib/format';
import { FOR_ME, forMeSymbol, forMeWord, useResolvedMode, useVizColors } from '../../theme/viz';
import { PlayerAvatar } from '../foundations/avatars/PlayerAvatar';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { STATUS_LABEL, catLabel, deadlineLabel, etClock, etDate, formatValue, positionsLabel, ptsDelta, shortDate, statValue, weekdayOf } from '../foundations/seasonFormat';
import { MILESTONE_GLYPH } from './milestones';

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/* ------------------------------------------------------------ 1. scoreboard */

function TeamMark({ name, record, align }: { name: string; record: string | null; align: 'left' | 'right' }) {
  return (
    <Box sx={{ minWidth: 0, textAlign: align, display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Box aria-hidden sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'action.selected', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'text.secondary' }}>
        {initials(name)}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5, maxWidth: '100%' }} noWrap>
        {name}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {record ?? '—'}
      </Typography>
    </Box>
  );
}

/** Scoreboard: my team left, the category score in the middle, the opponent right, and the week-progress bar. */
export function Scoreboard({ gc }: { gc: GameCenterResponse }) {
  const viz = useVizColors();
  const w = gc.week;
  const todayIdx = Math.max(0, gc.days.findIndex((d) => d.is_today));
  const fill = gc.final ? 1 : (todayIdx + 0.5) / 7;
  const status = gc.final
    ? `Final · ${gc.final.outcome === 'win' ? 'you won' : gc.final.outcome === 'loss' ? 'you lost' : 'tied'}`
    : `${weekdayOf(w.today)} · ${w.days_left} day${w.days_left === 1 ? '' : 's'} left`;
  return (
    <Card sx={{ p: 1.5 }} aria-label="Scoreboard">
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 1, alignItems: 'center' }}>
        <TeamMark name={gc.me.name} record={gc.me.record} align="left" />
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1 }} aria-label={`Category score: you ${gc.score.me}, them ${gc.score.opp}`}>
            {gc.score.me} – {gc.score.opp}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            {gc.score.ties ? `${gc.score.ties} tied · ` : ''}categories
          </Typography>
        </Box>
        <TeamMark name={gc.opponent.name} record={gc.opponent.record} align="right" />
      </Box>
      <Typography variant="body2" sx={{ textAlign: 'center', fontWeight: 600, mt: 1 }}>
        {status}
      </Typography>
      <Box role="img" aria-label={`Week progress: ${gc.final ? 'complete' : `${weekdayOf(w.today)}, ${w.days_left} days left`}`} sx={{ position: 'relative', height: 10, mt: 0.75, borderRadius: 5, bgcolor: viz.meterTrack, overflow: 'visible' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${fill * 100}%`, borderRadius: 5, bgcolor: viz.meterFill }} />
        {Array.from({ length: 6 }, (_, i) => (
          <Box key={i} aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: `${((i + 1) / 7) * 100}%`, width: '2px', bgcolor: viz.surface }} />
        ))}
        {!gc.final && <Box aria-hidden sx={{ position: 'absolute', top: -5, left: `calc(${fill * 100}% - 6px)`, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${viz.axis}` }} />}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', mt: 0.25 }} aria-hidden>
        {gc.days.map((d) => (
          <Typography key={d.date} variant="caption" sx={{ textAlign: 'center', fontSize: 10, color: d.is_today ? 'text.primary' : 'text.secondary', fontWeight: d.is_today ? 700 : 400 }}>
            {d.weekday[0]}
          </Typography>
        ))}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary' }}>
          {gc.games_left.me} games left
        </Typography>
        <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary' }}>
          {gc.games_left.opp} games left
        </Typography>
      </Stack>
    </Card>
  );
}

/* --------------------------------------------------------- 4. latest event */

export function LatestEvent({ gc, onOpen }: { gc: GameCenterResponse; onOpen: (m: GameCenterMoment) => void }) {
  const m = gc.moments[gc.moments.length - 1];
  if (!m) return null;
  return (
    <Card sx={{ p: 0 }}>
      <ButtonBase onClick={() => onOpen(m)} aria-haspopup="dialog" sx={{ display: 'flex', width: '100%', p: 1.5, gap: 1.25, alignItems: 'flex-start', textAlign: 'left', justifyContent: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" component="p" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            Latest · {weekdayOf(etDate(m.ts))} {etClock(m.ts)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {MILESTONE_GLYPH[m.kind].glyph} {m.headline}
          </Typography>
          <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
            {m.delta_p_win == null ? 'No change computed' : `${forMeSymbol(m.delta_p_win, 0.002)} ${ptsDelta(m.delta_p_win)} P(win week)`}
            {m.category ? ` · ${catLabel(m.category, gc.week.categories)}` : ''}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }} className="tabular">
            {m.score_after.me}–{m.score_after.opp}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            score
          </Typography>
        </Box>
      </ButtonBase>
    </Card>
  );
}

/* ------------------------------------------------------- 5. category score */

function linescoreSheet(r: LinescoreRow, cats: SeasonCategory[], opp: string): SheetContent {
  const c = cats.find((x) => x.key === r.key);
  const ratio = c?.is_ratio ?? false;
  const e = (x: LinescoreRow['me']['projected']) => (x ? `${statValue(x.mean, ratio)} ± ${statValue(x.sd, ratio)} (80% ${statValue(x.lo, ratio)}–${statValue(x.hi, ratio)})` : '—');
  const lead = r.leader === 'me' ? '▲ You lead' : r.leader === 'opp' ? `▼ ${opp} leads` : '● Tied';
  return {
    title: catLabel(r.key, cats),
    subtitle: r.punted ? 'Punted' : c && !c.higher_is_better ? 'Fewer wins' : undefined,
    effect: `${lead} right now`,
    sections: [
      { heading: 'So far', lines: [`You ${statValue(r.me.total, ratio)} · ${opp} ${statValue(r.opp.total, ratio)}`] },
      { heading: 'Projected final', lines: [`You ${e(r.me.projected)}`, `${opp} ${e(r.opp.projected)}`] },
      { heading: 'Chance you win it', lines: [r.p_win ? `${pct(r.p_win.p)} (80% band ${pct(r.p_win.lo)}–${pct(r.p_win.hi)})` : 'No estimate'] },
    ],
  };
}

/** Linescore: Me / Opp × 9 categories, the leader marked (green ▲ / red ▼), P(win) under each, swing strip. */
export function Linescore({ gc }: { gc: GameCenterResponse }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const cats = gc.week.categories;
  const [open, setOpen] = useState<LinescoreRow | null>(null);
  const cols = `52px repeat(${gc.linescore.length}, minmax(0, 1fr))`;
  const cell = { textAlign: 'center' as const, fontSize: 11.5, lineHeight: '26px', fontVariantNumeric: 'tabular-nums' };
  return (
    <Card sx={{ p: 1.25 }}>
      <Typography variant="subtitle2" component="h2" sx={{ px: 0.25 }}>
        Category score
      </Typography>
      <Box role="table" aria-label="Category score" sx={{ display: 'grid', gridTemplateColumns: cols, rowGap: '2px', columnGap: '2px', mt: 0.75 }}>
        <span />
        {gc.linescore.map((r) => (
          <Typography key={r.key} role="columnheader" sx={{ ...cell, fontWeight: 700, color: 'text.secondary' }}>
            {catLabel(r.key, cats)}
          </Typography>
        ))}
        {(['me', 'opp'] as const).map((side) => (
          <Box key={side} role="row" sx={{ display: 'contents' }}>
            <Typography role="rowheader" variant="caption" noWrap sx={{ fontWeight: 700, lineHeight: '30px' }}>
              {side === 'me' ? 'You' : 'Opp'}
            </Typography>
            {gc.linescore.map((r) => {
              const lead = r.leader === side;
              const bg = lead && !r.punted ? (side === 'me' ? fm.goodRamp[0] : fm.badRamp[0]) : null;
              const ratio = cats.find((c) => c.key === r.key)?.is_ratio ?? false;
              return (
                <ButtonBase
                  key={r.key}
                  role="cell"
                  aria-haspopup="dialog"
                  aria-label={`${catLabel(r.key, cats)} ${side === 'me' ? 'you' : 'them'}: ${statValue(r[side].total, ratio)}${lead ? ', leading' : ''}`}
                  onClick={() => setOpen(r)}
                  sx={[{ ...cell, height: 30, minWidth: 0, borderRadius: 1, fontWeight: lead ? 700 : 400, color: 'text.primary' }, bg != null && { bgcolor: bg, color: inkOn(bg) }]}
                >
                  {statValue(r[side].total, ratio, 0)}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
        <Typography variant="caption" sx={{ lineHeight: '22px', color: 'text.secondary' }}>
          Lead
        </Typography>
        {gc.linescore.map((r) => (
          <Typography key={r.key} aria-hidden sx={{ ...cell, lineHeight: '22px', fontWeight: 700 }}>
            {r.punted ? '–' : r.leader === 'me' ? '▲' : r.leader === 'opp' ? '▼' : '●'}
          </Typography>
        ))}
        <Typography variant="caption" sx={{ lineHeight: '22px', color: 'text.secondary' }}>
          P(win)
        </Typography>
        {gc.linescore.map((r) => (
          <Typography key={r.key} sx={{ ...cell, lineHeight: '22px', color: 'text.secondary', fontSize: 11 }}>
            {r.p_win ? Math.round(r.p_win.p * 100) : '—'}
          </Typography>
        ))}
      </Box>
      {gc.swing.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Swing categories:
          </Typography>
          {gc.swing.map((k) => {
            const r = gc.linescore.find((x) => x.key === k)!;
            return <Chip key={k} size="small" variant="outlined" label={`${catLabel(k, cats)} ${r.p_win ? pct(r.p_win.p) : '—'}`} onClick={() => setOpen(r)} sx={{ borderStyle: 'dashed', borderColor: viz.axis }} />;
          })}
        </Box>
      )}
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Week-to-date totals; shaded = who leads (green ▲ you, red ▼ them). P(win) in %. Tap a cell for the projected final.
      </Typography>
      <DetailSheet open={open != null} onClose={() => setOpen(null)} content={open ? linescoreSheet(open, cats, gc.opponent.name) : null} />
    </Card>
  );
}

/* ---------------------------------------------------------- 6. key moments */

export function MomentsFeed({ gc, onOpen }: { gc: GameCenterResponse; onOpen: (m: GameCenterMoment) => void }) {
  const [mode, setMode] = useState<'key' | 'all'>('key');
  const list = [...gc.moments].filter((m) => mode === 'all' || m.key).reverse();
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" component="h2">
          Moments
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: 'key' | 'all' | null) => v && setMode(v)} aria-label="Moments filter">
          <ToggleButton value="key" sx={{ px: 1.25 }}>
            Key moments
          </ToggleButton>
          <ToggleButton value="all" sx={{ px: 1.25 }}>
            All updates
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {list.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Nothing yet this week.
        </Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0, mt: 0.5 }}>
          {list.map((m) => (
            <Box component="li" key={m.id} sx={{ listStyle: 'none', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
              <ButtonBase onClick={() => onOpen(m)} aria-haspopup="dialog" sx={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 1, width: '100%', py: 0.75, textAlign: 'left', minHeight: 44, alignItems: 'start' }}>
                <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary', pt: '2px' }}>
                  {weekdayOf(etDate(m.ts))} {etClock(m.ts)}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">
                    <Box component="span" aria-hidden sx={{ fontWeight: 800, mr: 0.5 }}>
                      {MILESTONE_GLYPH[m.kind].glyph}
                    </Box>
                    {m.headline}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {MILESTONE_GLYPH[m.kind].label} · score {m.score_after.me}–{m.score_after.opp}
                  </Typography>
                </Box>
                <Typography variant="body2" className="tabular" sx={{ fontWeight: 700 }}>
                  {m.delta_p_win == null ? '—' : `${forMeSymbol(m.delta_p_win, 0.002)} ${ptsDelta(m.delta_p_win, 1, '')}`}
                </Typography>
              </ButtonBase>
            </Box>
          ))}
        </Box>
      )}
    </Card>
  );
}

/* -------------------------------------------------------- 7. team strength */

const GROUP_LABEL: Record<StrengthRow['group'], string> = { games: 'Games', positions: 'Playable games by position (rest of week)', minutes: 'Minutes', categories: 'Projected end-of-week totals' };

/** Mirrored bars: you (hatched blue, left) vs them (solid gray, right); identity is pattern + side, not color alone. */
export function StrengthComparison({ gc }: { gc: GameCenterResponse }) {
  const viz = useVizColors();
  const hatch = `repeating-linear-gradient(135deg, ${viz.meterFill} 0 3px, transparent 3px 6px)`;
  const groups = [...new Set(gc.strength.map((r) => r.group))];
  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2">
        Team comparison
      </Typography>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }} aria-label="Legend">
        <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 700 }}>
          <Box aria-hidden sx={{ width: 16, height: 10, borderRadius: 0.5, backgroundImage: hatch, border: `1px solid ${viz.meterFill}` }} /> You
        </Typography>
        <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 700 }}>
          {gc.opponent.name} <Box aria-hidden sx={{ width: 16, height: 10, borderRadius: 0.5, bgcolor: viz.neutral }} />
        </Typography>
      </Stack>
      {groups.map((g) => (
        <Box key={g} sx={{ mt: 1 }}>
          <Typography variant="overline" component="h3" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.6 }}>
            {GROUP_LABEL[g]}
          </Typography>
          {gc.strength
            .filter((r) => r.group === g)
            .map((r) => {
              const max = Math.max(Math.abs(r.me ?? 0), Math.abs(r.opp ?? 0)) || 1;
              // Bar lengths are display geometry from the engine's two values.
              const wMe = ((r.me ?? 0) / max) * 100;
              const wOpp = ((r.opp ?? 0) / max) * 100;
              const meBetter = r.me != null && r.opp != null && (r.higher_is_better ? r.me > r.opp : r.me < r.opp);
              const oppBetter = r.me != null && r.opp != null && (r.higher_is_better ? r.opp > r.me : r.opp < r.me);
              return (
                <Box key={r.key} sx={{ py: 0.5 }} aria-label={`${r.label}: you ${formatValue(r.me, r.format)}, them ${formatValue(r.opp, r.format)}`}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '64px 1fr 64px', alignItems: 'baseline', gap: 0.5 }}>
                    <Typography variant="body2" className="tabular" sx={{ fontWeight: meBetter ? 700 : 400 }}>
                      {formatValue(r.me, r.format)}
                    </Typography>
                    <Typography variant="caption" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                      {r.label}
                      {!r.higher_is_better ? ' (fewer is better)' : ''}
                    </Typography>
                    <Typography variant="body2" className="tabular" sx={{ textAlign: 'right', fontWeight: oppBetter ? 700 : 400 }}>
                      {formatValue(r.opp, r.format)}
                    </Typography>
                  </Box>
                  <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', mt: 0.25 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Box sx={{ width: `${wMe}%`, height: 8, borderRadius: '4px 0 0 4px', backgroundImage: hatch, border: `1px solid ${viz.meterFill}` }} />
                    </Box>
                    <Box>
                      <Box sx={{ width: `${wOpp}%`, height: 8, borderRadius: '0 4px 4px 0', bgcolor: viz.neutral }} />
                    </Box>
                  </Box>
                </Box>
              );
            })}
        </Box>
      ))}
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Bold = the better side. Projected rows are the engine’s means.
      </Typography>
    </Card>
  );
}

/* ---------------------------------------------------------- 8. week volume */

/** Me / Opp × Mon–Sun playable games: labels only (weekday, date); colored by your edge that day; tap for who plays. */
export function VolumeMap({ gc, onOpenPlayer }: { gc: GameCenterResponse; onOpenPlayer?: (p: PlayerRef) => void }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const [open, setOpen] = useState<number | null>(null);
  const d = open == null ? null : gc.days[open];
  const color = (e: number) => (e > 0 ? fm.goodRamp[Math.min(2, e - 1)]! : e < 0 ? fm.badRamp[Math.min(2, -e - 1)]! : null);
  const sheet: SheetContent | null = d
    ? {
        title: `${d.weekday} ${shortDate(d.date)}${d.is_today ? ' · today' : d.is_past ? ' · played' : ''}`,
        effect: `${forMeSymbol(d.playable_edge)} Playable-game edge ${d.playable_edge > 0 ? '+' : ''}${d.playable_edge} · ${forMeWord(d.playable_edge)}`,
        sections: [
          { heading: `You: ${d.me_playable} playable of ${d.me_games}`, lines: d.me_players.length ? d.me_players.map((p) => `${p.name} (${positionsLabel(p.eligible)}, ${p.team_abbr ?? '—'})`) : ['Nobody plays'] },
          { heading: `${gc.opponent.name}: ${d.opp_playable} playable of ${d.opp_games}`, lines: d.opp_players.length ? d.opp_players.map((p) => `${p.name} (${positionsLabel(p.eligible)}, ${p.team_abbr ?? '—'})`) : ['Nobody plays'] },
        ],
        actions: onOpenPlayer && d.me_players[0] ? [{ label: `Open ${d.me_players[0].name}`, onClick: () => onOpenPlayer(d.me_players[0]!) }] : undefined,
      }
    : null;
  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2">
        Week volume
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        Playable games by day · shaded = who has more (green ▲ you, red ▼ them), ● even
      </Typography>
      <Box role="grid" aria-label="Playable games by day" sx={{ display: 'grid', gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))', gap: '3px', mt: 0.75 }}>
        <span />
        {gc.days.map((x) => (
          <Box key={x.date} role="columnheader" sx={{ textAlign: 'center', opacity: x.is_past ? 0.55 : 1 }}>
            <Typography variant="caption" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {x.weekday}
            </Typography>
            <Typography variant="caption" component="p" sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.2 }}>
              {Number(x.date.slice(8))}
            </Typography>
          </Box>
        ))}
        {(['me', 'opp'] as const).map((side) => (
          <Box key={side} role="row" sx={{ display: 'contents' }}>
            <Typography role="rowheader" variant="caption" sx={{ fontWeight: 700, alignSelf: 'center' }}>
              {side === 'me' ? 'You' : 'Opp'}
            </Typography>
            {gc.days.map((x, i) => {
              // Only the side with more playable games is shaded: green ▲ on yours, red ▼ on theirs.
              const mine = side === 'me';
              const wins = mine ? x.playable_edge > 0 : x.playable_edge < 0;
              const bg = wins ? color(x.playable_edge) : null;
              return (
                <ButtonBase
                  key={x.date}
                  role="gridcell"
                  aria-haspopup="dialog"
                  aria-label={`${side === 'me' ? 'You' : 'Them'}, ${x.weekday}: ${forMeWord(x.playable_edge)}. Opens details.`}
                  onClick={() => setOpen(i)}
                  sx={[
                    { height: 44, borderRadius: 1.5, border: `1px solid ${viz.grid}`, fontSize: 12, fontWeight: 800, opacity: x.is_past ? 0.55 : 1, outline: x.is_today ? '2px solid var(--mui-palette-primary-main)' : 'none' },
                    bg != null && { bgcolor: bg, borderColor: bg, color: inkOn(bg) },
                  ]}
                >
                  {wins ? forMeSymbol(x.playable_edge) : x.playable_edge === 0 && mine ? '●' : ''}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
      </Box>
      <DetailSheet open={sheet != null} onClose={() => setOpen(null)} content={sheet} />
    </Card>
  );
}

/* ------------------------------------------------------ 9. injuries, pickups */

const STATUS_TONE: Record<InjuryStatus, 'error' | 'warning' | 'info' | 'success'> = {
  out: 'error',
  suspended: 'error',
  doubtful: 'warning',
  questionable: 'warning',
  day_to_day: 'info',
  probable: 'info',
  healthy: 'success',
};

export function InjuryReport({ gc, onOpenPlayer }: { gc: GameCenterResponse; onOpenPlayer?: (p: PlayerRef) => void }) {
  const sides = [
    { key: 'me' as const, title: 'Your roster' },
    { key: 'opp' as const, title: gc.opponent.name },
  ];
  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2">
        Injury report
      </Typography>
      {gc.injuries.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Nobody on either roster is listed.
        </Typography>
      )}
      {sides.map((s) => {
        const rows = gc.injuries.filter((r) => r.side === s.key);
        if (!rows.length) return null;
        return (
          <Box key={s.key} sx={{ mt: 1 }}>
            <Typography variant="overline" component="h3" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.6 }}>
              {s.title}
            </Typography>
            {rows.map((r) => (
              <ButtonBase
                key={r.player.player_id}
                onClick={() => onOpenPlayer?.(r.player)}
                disabled={!onOpenPlayer}
                sx={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 1, width: '100%', py: 0.5, textAlign: 'left', minHeight: 44, alignItems: 'center' }}
              >
                <PlayerAvatar name={r.player.name} headshotUrl={r.player.headshot_url} size={32} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {r.player.name}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                    <Box aria-hidden component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: `${STATUS_TONE[r.player.status.code]}.main`, mr: 0.5 }} />
                    {positionsLabel(r.player.eligible)} · {STATUS_LABEL[r.player.status.code]} · back {r.est_return ?? 'unknown'}
                  </Typography>
                </Box>
                <Typography variant="body2" className="tabular" sx={{ fontWeight: 700, textAlign: 'right' }}>
                  {r.delta_p_win == null ? '—' : `${forMeSymbol(r.delta_p_win, 0.002)} ${ptsDelta(r.delta_p_win, 1, '')}`}
                  <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary', fontWeight: 400 }}>
                    pts for you
                  </Typography>
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        );
      })}
    </Card>
  );
}

export function PickupsCard({ gc, onOpenPlayer }: { gc: GameCenterResponse; onOpenPlayer?: (p: PlayerRef) => void }) {
  const cats = gc.week.categories;
  const left = Math.max(0, gc.acquisitions.max - gc.acquisitions.used);
  if (gc.final) return null;
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" component="h2">
          Pickups that improve your odds
        </Typography>
        <Chip size="small" variant="outlined" label={`${left} of ${gc.acquisitions.max} left`} />
      </Stack>
      {gc.pickups.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          No free agent raises P(win week) right now.
        </Typography>
      ) : (
        gc.pickups.map((c) => (
          <ButtonBase
            key={c.player.player_id}
            onClick={() => onOpenPlayer?.(c.player)}
            disabled={!onOpenPlayer}
            sx={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 1, width: '100%', py: 0.75, textAlign: 'left', minHeight: 44, alignItems: 'center', borderTop: 1, borderColor: 'divider' }}
          >
            <PlayerAvatar name={c.player.name} headshotUrl={c.player.headshot_url} size={32} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {c.player.name}
                {c.drop ? ` for ${c.drop.name}` : ''}
              </Typography>
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                Helps {c.cats_helped.map((k) => catLabel(k, cats)).join(', ') || '—'} · {cap(deadlineLabel(c.deadline, gc.week.today))}
              </Typography>
            </Box>
            <Typography variant="body2" className="tabular" sx={{ fontWeight: 700 }}>
              {ptsDelta(c.delta_p_win.mean)}
            </Typography>
          </ButtonBase>
        ))
      )}
      {left === 0 && gc.pickups.length > 0 && (
        <Typography variant="caption" component="p" sx={{ color: 'warning.dark', fontWeight: 600, mt: 0.5 }}>
          No acquisitions left this week.
        </Typography>
      )}
    </Card>
  );
}
