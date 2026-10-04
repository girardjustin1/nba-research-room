import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
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
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { LineChart } from '@mui/x-charts/LineChart';
import { ScatterChart } from '@mui/x-charts/ScatterChart';
import type { FactorDetail, GameRef, IsoDate, SeasonCategory } from '../../api/season';
import { ordinal, pct } from '../../lib/format';
import { FOR_ME, forMeSymbol, useResolvedMode, useVizColors } from '../../theme/viz';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { HeatCalendar, type HeatDay } from '../foundations/HeatCalendar';
import { inkOn } from '../foundations/heatScale';
import { SignedBarChart } from '../foundations/SignedBarChart';
import { STATUS_LABEL, TIER_LABEL, catLabel, etClock, ptsDelta, signedNum, statValue, weekdayOf } from '../foundations/seasonFormat';

const gameLabel = (g: GameRef) => `${weekdayOf(g.date)} ${g.home ? 'vs' : '@'} ${g.opp_abbr}`;
const cell = { px: 0.5 } as const;

function ViewToggle({ value, onChange, label }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void; label: string }) {
  return (
    <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v: 'chart' | 'table' | null) => v && onChange(v)} aria-label={label}>
      <ToggleButton value="chart" sx={{ px: 1.25 }}>
        Chart
      </ToggleButton>
      <ToggleButton value="table" sx={{ px: 1.25 }}>
        Table
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

function Trend({ d }: { d: Extract<FactorDetail, { kind: 'minutes' | 'usage' }> }) {
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const f = (v: number | null) => (v == null ? '—' : d.unit === 'fraction' ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
  const chips: [string, number | null][] = [
    ['Last 3', d.rolling3],
    ['Last 5', d.rolling5],
    ['Last 10', d.rolling10],
    ['EWMA', d.ewma],
    ['Season', d.season],
  ];
  return (
    <Box>
      <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
        {chips.map(([l, v]) => (
          <Chip key={l} size="small" variant="outlined" label={`${l} ${f(v)}`} />
        ))}
      </Stack>
      {d.projected && (
        <Typography variant="body2" className="tabular" sx={{ mt: 0.75 }}>
          Projected {f(d.projected.mean)} ± {f(d.projected.sd)} (80% band {f(d.projected.lo)}–{f(d.projected.hi)})
        </Typography>
      )}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Last {d.games.length} games, oldest first{d.games.some((g) => g.value == null) ? ' · gaps = did not play' : ''}
        </Typography>
        <ViewToggle value={view} onChange={setView} label="Trend view" />
      </Stack>
      {view === 'chart' ? (
        <LineChart
          height={120}
          skipAnimation
          hideLegend
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
          grid={{ horizontal: true }}
          xAxis={[{ scaleType: 'point', data: d.games.map((g) => g.opp_abbr), tickLabelStyle: { fontSize: 10, fill: viz.muted }, disableTicks: true, height: 20 }]}
          yAxis={[{ width: 34, tickNumber: 3, valueFormatter: (v: number | null) => (v == null ? '' : d.unit === 'fraction' ? `${Math.round(v * 100)}%` : String(Math.round(v))), tickLabelStyle: { fontSize: 10, fill: viz.muted }, disableLine: true, disableTicks: true }]}
          series={[{ data: d.games.map((g) => g.value), color: viz.meterFill, showMark: true, connectNulls: false, label: d.kind === 'minutes' ? 'Minutes' : 'Usage' }]}
          sx={{ '& .MuiChartsGrid-line': { stroke: viz.grid }, '& .MuiLineElement-root': { strokeWidth: 2 } }}
        >
          {d.ewma != null && <ChartsReferenceLine y={d.ewma} label={`EWMA ${f(d.ewma)}`} labelAlign="start" lineStyle={{ stroke: viz.axis, strokeWidth: 1 }} labelStyle={{ fontSize: 10, fill: viz.muted }} />}
        </LineChart>
      ) : (
        <Table size="small" aria-label="Recent games">
          <TableHead>
            <TableRow>
              <TableCell sx={cell}>Game</TableCell>
              <TableCell align="right" sx={cell}>
                {d.kind === 'minutes' ? 'Minutes' : 'Usage'}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.games.map((g) => (
              <TableRow key={g.date}>
                <TableCell sx={cell}>{g.opp_abbr}</TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.value == null ? 'DNP' : f(g.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

function ModelsDot({ d }: { d: Extract<FactorDetail, { kind: 'models' }> }) {
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const xs = [...d.models.map((m) => m.mean), d.ensemble.lo, d.ensemble.hi];
  const pad = 1.5;
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Dots = each model · lines = ensemble {d.ensemble.mean} and its 80% band
        </Typography>
        <ViewToggle value={view} onChange={setView} label="Models view" />
      </Stack>
      {view === 'chart' ? (
        <ScatterChart
          height={d.models.length * 30 + 40}
          skipAnimation
          hideLegend
          margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
          grid={{ vertical: true }}
          xAxis={[{ min: Math.floor(Math.min(...xs) - pad), max: Math.ceil(Math.max(...xs) + pad), tickNumber: 4, tickLabelStyle: { fontSize: 11, fill: viz.muted }, disableTicks: true, height: 22 }]}
          yAxis={[
            {
              min: -0.6,
              max: d.models.length - 0.4,
              tickInterval: d.models.map((_, i) => i),
              valueFormatter: (v: number | null) => (v == null ? '' : (d.models[d.models.length - 1 - Math.round(v)]?.model ?? '')),
              width: 96,
              disableTicks: true,
              disableLine: true,
              tickLabelStyle: { fontSize: 12, fill: 'var(--mui-palette-text-primary)' },
            },
          ]}
          series={[
            {
              data: d.models.map((m, i) => ({ x: m.mean, y: d.models.length - 1 - i, id: m.model })),
              color: viz.meterFill,
              markerSize: 6,
              valueFormatter: (v) => (v ? `${v.x}` : ''),
            },
          ]}
          sx={{ '& .MuiChartsGrid-line': { stroke: viz.grid } }}
        >
          <ChartsReferenceLine x={d.ensemble.lo} lineStyle={{ stroke: viz.axis, strokeWidth: 1 }} />
          <ChartsReferenceLine x={d.ensemble.mean} lineStyle={{ stroke: viz.muted, strokeWidth: 2 }} />
          <ChartsReferenceLine x={d.ensemble.hi} lineStyle={{ stroke: viz.axis, strokeWidth: 1 }} />
        </ScatterChart>
      ) : null}
      <Table size="small" aria-label="Model projections">
        <TableHead>
          <TableRow>
            <TableCell sx={cell}>Model</TableCell>
            <TableCell align="right" sx={cell}>
              Mean ± sd
            </TableCell>
            <TableCell align="right" sx={cell}>
              Weight
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {d.models.map((m) => (
            <TableRow key={m.model}>
              <TableCell sx={cell}>
                {m.model}
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                  {m.model === 'EWMA baseline' ? 'baseline' : m.beats_baseline ? 'beats EWMA' : 'gated off'}
                </Typography>
              </TableCell>
              <TableCell align="right" className="tabular" sx={cell}>
                {m.mean} ± {m.sd}
              </TableCell>
              <TableCell align="right" className="tabular" sx={cell}>
                {m.weight == null ? '—' : m.weight.toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function SlotFit({ d }: { d: Extract<FactorDetail, { kind: 'slot_fit' }> }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const [sel, setSel] = useState<{ slot: string; date: IsoDate } | null>(null);
  const eligible = d.slots.filter((s) => s.eligible);
  const ineligible = d.slots.filter((s) => !s.eligible).map((s) => s.slot);
  const s = sel ? eligible.find((x) => x.slot === sel.slot) : null;
  const day = s && sel ? s.by_day.find((b) => b.date === sel.date) : null;
  const sheet: SheetContent | null =
    s && day
      ? {
          title: `${s.slot} · ${weekdayOf(day.date)}`,
          effect: day.open && day.delta_p_win != null ? `${forMeSymbol(day.delta_p_win)} ${ptsDelta(day.delta_p_win)} P(win week)` : null,
          sections: [
            {
              heading: 'Slot',
              lines: [day.open ? `Open: putting him at ${s.slot} changes P(win week) by ${ptsDelta(day.delta_p_win)}.` : `Full: every eligible ${s.slot} slot is taken by a starter with a game.`],
            },
          ],
        }
      : null;
  return (
    <Box>
      <Box role="grid" aria-label="Slot fit by day" sx={{ display: 'grid', gridTemplateColumns: `48px repeat(${d.days.length}, minmax(0, 1fr))`, gap: '3px' }}>
        <span />
        {d.days.map((x) => (
          <Typography key={x} variant="caption" role="columnheader" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>
            {weekdayOf(x)}
          </Typography>
        ))}
        {eligible.map((slot) => (
          <Box key={slot.slot} role="row" sx={{ display: 'contents' }}>
            <Typography variant="body2" role="rowheader" sx={{ alignSelf: 'center', fontWeight: slot.slot === d.best_slot ? 700 : 400 }}>
              {slot.slot}
              {slot.slot === d.best_slot ? ' ★' : ''}
            </Typography>
            {d.days.map((date) => {
              const b = slot.by_day.find((x) => x.date === date);
              const open = !!b?.open;
              const bg = open ? fm.goodRamp[1] : null;
              return (
                <ButtonBase
                  key={date}
                  role="gridcell"
                  aria-haspopup="dialog"
                  aria-label={`${slot.slot} ${weekdayOf(date)}: ${open ? 'open' : 'full'}`}
                  onClick={() => setSel({ slot: slot.slot, date })}
                  sx={[
                    { height: 44, borderRadius: 1, fontSize: 12, fontWeight: 700, border: `1px dashed ${viz.axis}`, color: 'text.secondary' },
                    bg != null && { bgcolor: bg, color: inkOn(bg), border: `1px solid ${bg}` },
                  ]}
                >
                  {open ? '▲ open' : 'full'}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
      </Box>
      {ineligible.length > 0 && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Not eligible: {ineligible.join(', ')}. ★ = best slot. Tap a cell for its effect.
        </Typography>
      )}
      <DetailSheet open={sheet != null} onClose={() => setSel(null)} content={sheet} />
    </Box>
  );
}

function ScheduleWeek({ d, today }: { d: Extract<FactorDetail, { kind: 'schedule' }>; today: IsoDate }) {
  const days: HeatDay[] = d.days.map((x) => ({
    date: x.date,
    state: x.game ? 'game' : 'no_game',
    value: null,
    effect: x.game && x.date >= today ? (x.would_start ? 1 : 0) : null,
    tableValue: x.game ? `${x.game.home ? 'vs' : '@'} ${x.game.opp_abbr}` : null,
    markers: { today: x.date === today, light: x.light_day, b2b: !!x.game?.b2b },
    sheet: {
      title: `${x.weekday} · ${x.game ? gameLabel(x.game) : 'no game'}`,
      subtitle: x.game ? (x.game.tip_at ? `Tip ${etClock(x.game.tip_at)} ET` : 'Tip time not set') : undefined,
      sections: [
        {
          heading: 'Your lineup that day',
          lines: x.date < today ? ['Already played.'] : [`Open slots he fits: ${x.open_slots}.`, x.game ? (x.would_start ? 'He would start: a playable game.' : 'Your slots are full: he would sit.') : 'No game.'],
        },
      ],
    },
  }));
  return (
    <HeatCalendar days={days} view="week" anchor={d.days[0]?.date ?? today} title="His games vs your open slots" scale={{ kind: 'binary', min: 0, max: 1, label: '', lowLabel: '', highLabel: '', format: String }} />
  );
}

export function FactorDetailView({ detail: d, categories, today }: { detail: FactorDetail; categories: SeasonCategory[]; today: IsoDate }) {
  switch (d.kind) {
    case 'projection':
      return (
        <Table size="small" aria-label="Projected line">
          <TableHead>
            <TableRow>
              <TableCell sx={cell}>Cat</TableCell>
              <TableCell align="right" sx={cell}>
                Per game
              </TableCell>
              <TableCell align="right" sx={cell}>
                {d.games} games (80% band)
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.per_game.map((p) => {
              const w = d.week.find((x) => x.key === p.key);
              const ratio = categories.find((c) => c.key === p.key)?.is_ratio ?? false;
              return (
                <TableRow key={p.key}>
                  <TableCell sx={cell}>{catLabel(p.key, categories)}</TableCell>
                  <TableCell align="right" className="tabular" sx={cell}>
                    {statValue(p.mean, ratio)} ± {statValue(p.sd, ratio)}
                  </TableCell>
                  <TableCell align="right" className="tabular" sx={cell}>
                    {w ? `${statValue(w.mean, ratio)} (${statValue(w.lo, ratio)}–${statValue(w.hi, ratio)})` : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      );
    case 'schedule':
      return <ScheduleWeek d={d} today={today} />;
    case 'minutes':
    case 'usage':
      return <Trend d={d} />;
    case 'opponents':
      return (
        <Table size="small" aria-label="Opponents">
          <TableHead>
            <TableRow>
              <TableCell sx={cell}>Game</TableCell>
              <TableCell align="right" sx={cell}>
                Pace (rank)
              </TableCell>
              <TableCell align="right" sx={cell}>
                DRTG (rank)
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.games.map((g) => (
              <TableRow key={g.game.game_id}>
                <TableCell sx={cell}>{gameLabel(g.game)}</TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.pace ?? '—'} ({g.pace_rank ? ordinal(g.pace_rank) : '—'})
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.def_rating ?? '—'} ({g.def_rank ? ordinal(g.def_rank) : '—'})
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    case 'vegas':
      return (
        <Table size="small" aria-label="Vegas lines">
          <TableHead>
            <TableRow>
              {['Game', 'Spread', 'Total', 'Team', 'Blowout'].map((h, i) => (
                <TableCell key={h} align={i ? 'right' : 'left'} sx={cell}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {d.games.map((g) => (
              <TableRow key={g.game.game_id}>
                <TableCell sx={cell}>{gameLabel(g.game)}</TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.spread == null ? '—' : signedNum(g.spread)}
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.total ?? '—'}
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {g.implied_team_total ?? '—'}
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {pct(g.blowout_prob)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    case 'market':
      return d.lines.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No markets listed.
        </Typography>
      ) : (
        <Table size="small" aria-label="Market lines">
          <TableHead>
            <TableRow>
              {['Stat', 'Market', 'Ours', 'Read'].map((h, i) => (
                <TableCell key={h} align={i ? 'right' : 'left'} sx={cell}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {d.lines.map((l) => (
              <TableRow key={`${l.stat}-${l.venue}`}>
                <TableCell sx={cell}>
                  {l.stat === 'min' ? 'MIN' : catLabel(l.stat, categories)}
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                    {l.venue === 'kalshi' ? 'Kalshi' : l.book}
                  </Typography>
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {l.liquid ? `${l.line ?? '—'} (mean ${l.implied_mean ?? '—'})` : 'illiquid'}
                </TableCell>
                <TableCell align="right" className="tabular" sx={cell}>
                  {l.ours.mean} ± {l.ours.sd}
                </TableCell>
                <TableCell align="right" sx={cell}>
                  {l.agreement === 'agrees' ? 'agrees' : l.agreement === 'market_higher' ? 'market higher' : l.agreement === 'market_lower' ? 'market lower' : 'no market'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    case 'news':
      return (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {d.events.map((e) => (
            <Box component="li" key={e.at} sx={{ py: 0.75, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                {weekdayOf(e.at.slice(0, 10))} {etClock(e.at)} · {e.source.handle ?? e.source.display_name}
                {e.source.tier ? ` · ${TIER_LABEL[e.source.tier]}` : ''} · parse {pct(e.parse_confidence)}
              </Typography>
              <Typography variant="body2">{e.summary}</Typography>
              <Stack direction="row" sx={{ gap: 0.5, mt: 0.25, flexWrap: 'wrap' }}>
                {e.status && <Chip size="small" variant="outlined" label={STATUS_LABEL[e.status]} />}
                {e.minutes_cap != null && <Chip size="small" variant="outlined" label={`Cap ${e.minutes_cap} min`} />}
                {e.starting != null && <Chip size="small" variant="outlined" label={e.starting ? 'Starting' : 'Not starting'} />}
              </Stack>
            </Box>
          ))}
        </Box>
      );
    case 'teammates':
      return d.out.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Nobody out.
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {d.out.map((t) => (
            <Typography component="li" variant="body2" key={t.name} className="tabular">
              {t.name} ({STATUS_LABEL[t.status]}): usage {t.usage_bump == null ? '—' : `${signedNum(t.usage_bump * 100)} pts`}, minutes {signedNum(t.minutes_bump)} · {t.sample_games}-game sample
            </Typography>
          ))}
        </Box>
      );
    case 'slot_fit':
      return <SlotFit d={d} />;
    case 'category_fit':
      return (
        <SignedBarChart
          title="Change in P(win) by category"
          subtitle="With him vs without, pts of P(win) · • = close"
          rows={d.cats.map((c) => ({
            key: c.key,
            label: `${catLabel(c.key, categories)}${c.punted ? ' (punt)' : c.close ? ' •' : ''}`,
            value: c.delta_p,
            display: ptsDelta(c.delta_p, 0, ''),
            neutral: c.punted,
            readout: `${catLabel(c.key, categories)}: ${pct(c.p_without)} → ${pct(c.p_with)} (${ptsDelta(c.delta_p)})${c.close ? ', a close category' : ''}${c.punted ? ', punted' : ''}`,
          }))}
          domain={0.16}
          ticks={[-0.1, 0, 0.1]}
          tickFormat={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
          evenBand={0.005}
          table={{
            headers: ['Cat', 'Without', 'With', 'Change'],
            cells: (_r, i) => {
              const c = d.cats[i]!;
              return [catLabel(c.key, categories), pct(c.p_without), pct(c.p_with), ptsDelta(c.delta_p)];
            },
          }}
        />
      );
    case 'models':
      return <ModelsDot d={d} />;
    case 'drivers':
      return (
        <SignedBarChart
          title={`What moves his ${d.target === 'min' ? 'minutes' : catLabel(d.target, categories)}`}
          subtitle={`${d.model} SHAP · base ${d.base_value} ${d.target === 'min' ? 'min' : ''}`}
          rows={d.drivers.map((x) => ({
            key: x.feature,
            label: x.label,
            value: x.contribution,
            display: `${signedNum(x.contribution)}`,
            readout: `${x.label} (${x.value_label}): ${signedNum(x.contribution)} ${d.target === 'min' ? 'minutes' : ''}`,
          }))}
          domain={Math.ceil(Math.max(...d.drivers.map((x) => Math.abs(x.contribution))) * 1.6)}
          ticks={[-2, 0, 2]}
          tickFormat={(v) => `${v > 0 ? '+' : ''}${v}`}
          labelWidth={150}
          table={{
            headers: ['Driver', 'Value', 'Effect'],
            cells: (_r, i) => {
              const x = d.drivers[i]!;
              return [x.label, x.value_label, signedNum(x.contribution)];
            },
          }}
        />
      );
  }
}
