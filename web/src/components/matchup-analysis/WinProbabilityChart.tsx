import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
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
import { useDrawingArea, useXScale, useYScale } from '@mui/x-charts/hooks';
import { LineChart, lineClasses } from '@mui/x-charts/LineChart';
import type { CategoryKey, Scenario, SeasonCategory, WinProbPoint, WinProbabilityResponse } from '../../api/season';
import { fixed, pct } from '../../lib/format';
import { FOR_ME, forMeSymbol, forMeWord, useResolvedMode, useVizColors } from '../../theme/viz';
import { ProvenanceLine } from '../foundations/Confidence';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { MILESTONE_GLYPH, type Milestone } from './milestones';
import { EmptyState } from '../foundations/ScreenStates';
import { addDays, catDeltaLine, catLabel, etClock, etDate, etMidnightMs, pctRange, ptsDelta, weekdayOf } from '../foundations/seasonFormat';

/**
 * Plan-line colors: categorical slots 1–2 of the dataviz palette. validate_palette.js
 * --pairs all (lines can cross) with the do-nothing gray kept non-categorical:
 *   light #2a78d6,#eb6834,#1baf7a  PASS (CVD dE 9.2; aqua 2.74:1 → direct labels + table)
 *   dark  #3987e5,#d95926,#199e70  PASS (CVD dE 9.4)
 * A 4th line fails all-pairs in dark mode, so compare mode uses small multiples.
 */
const PLAN = { light: { rec: '#2a78d6', alt: '#eb6834' }, dark: { rec: '#3987e5', alt: '#d95926' } } as const;

const EVENT_LABEL = { nightly: 'Nightly run', games_final: 'Games final', news: 'News', lineup: 'Lineup', transaction: 'Transaction' } as const;

/** Mirrored y labels like a baseball win-probability graphic: 100 · 50 · 100. */
const mirrored = (v: number | null) => (v == null ? '' : String(Math.round(Math.max(v, 1 - v) * 100)));
const leader = (p: number, opp: string) => (p >= 0.5 ? `You ${pct(p)}` : `${opp} ${pct(1 - p)}`);

export interface WinProbabilityChartProps {
  data: WinProbabilityResponse;
  /** The "With moves" line: the selected plan (engine response); defaults to the recommended scenario. */
  withMoves?: Scenario | null;
  /** The engine is re-simulating the selection: the line fades and says so. */
  recomputing?: boolean;
  /** Move titles by id, for the projected-point sheet. */
  moveTitles?: Record<string, string>;
  categories?: SeasonCategory[];
  initialView?: 'chart' | 'table' | 'compare';
  /** 'week' = P(win week); a category key = that category's P(win) path (engine p_cats). */
  metric?: CategoryKey | 'week';
  /** False hides the "With moves" line (the plain Win probability view). */
  showPlan?: boolean;
  /** Milestone icon dots (Game Center); tapping one calls onMilestone. */
  milestones?: Milestone[];
  onMilestone?: (id: string) => void;
  /** Hide the title row (the caller renders its own). */
  hideTitle?: boolean;
  /** Controlled open point (ts); ThisWeek links the news list to it. */
  openTs?: string | null;
  onOpenTs?: (ts: string | null) => void;
}

/** Final-value labels at the right edge with thin leader lines; spaced so they never stack on each other. */
function EndLabels({ items }: { items: { id: string; value: number; text: string; color: string }[] }) {
  const y = useYScale('f') as unknown as (v: number) => number;
  const { left, width } = useDrawingArea();
  const viz = useVizColors();
  const x = left + width;
  const placed = items
    .map((it) => ({ ...it, y0: y(it.value) }))
    .sort((a, b) => a.y0 - b.y0)
      .reduce<{ id: string; value: number; text: string; color: string; y0: number; ly: number }[]>((acc, it) => {
      const prev = acc[acc.length - 1];
      acc.push({ ...it, ly: prev ? Math.max(it.y0, prev.ly + 14) : it.y0 });
      return acc;
    }, []);
  return (
    <g aria-hidden>
      {placed.map((p) => (
        <g key={p.id}>
          <line x1={x + 1} y1={p.y0} x2={x + 7} y2={p.ly} stroke={viz.axis} strokeWidth={1} />
          <rect x={x + 8} y={p.ly - 1} width={8} height={2} fill={p.color} />
          <text x={x + 19} y={p.ly + 4} fontSize={11} fontWeight={700} fill="var(--mui-palette-text-primary)">
            {p.text}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Event dots on the past line (MUI's own marks take the surface color under a colorMap). */
function EventDots({ points }: { points: { ts: string; p: number; color: string }[] }) {
  const x = useXScale() as unknown as (v: Date) => number;
  const y = useYScale('p') as unknown as (v: number) => number;
  const viz = useVizColors();
  return (
    <g aria-hidden>
      {points.map((d) => (
        <circle key={d.ts} cx={x(new Date(d.ts))} cy={y(d.p)} r={4.5} fill={d.color} stroke={viz.surface} strokeWidth={2} />
      ))}
    </g>
  );
}

function MilestoneDots({ items, onPick }: { items: { m: Milestone; y: number }[]; onPick?: (id: string) => void }) {
  const x = useXScale() as unknown as (v: Date) => number;
  const y = useYScale('p') as unknown as (v: number) => number;
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  return (
    <g>
      {items.map(({ m, y: v }) => {
        const fill = m.delta_p_win == null || Math.abs(m.delta_p_win) < 0.002 ? fm.neutral : m.delta_p_win > 0 ? fm.good : fm.bad;
        const cx = x(new Date(m.ts));
        const cy = y(v);
        return (
          <g
            key={m.id}
            role="button"
            tabIndex={0}
            aria-label={`${MILESTONE_GLYPH[m.kind].label}: ${m.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onPick?.(m.id);
            }}
            onKeyDown={(e) => e.key === 'Enter' && onPick?.(m.id)}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
          >
            <circle cx={cx} cy={cy} r={14} fill="transparent" />
            <circle cx={cx} cy={cy} r={7.5} fill={fill} stroke={viz.surface} strokeWidth={2} />
            <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={800} fill={inkOn(fill)} style={{ pointerEvents: 'none' }}>
              {MILESTONE_GLYPH[m.kind].glyph}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function historySheet(p: WinProbPoint, opp: string): SheetContent {
  return {
    title: `${weekdayOf(etDate(p.ts))} ${etClock(p.ts)}`,
    subtitle: p.event ? `${EVENT_LABEL[p.event.kind]}: ${p.event.label}` : 'Snapshot',
    effect: p.event ? `${forMeSymbol(p.event.delta_p, 0.002)} ${p.event.label} → ${ptsDelta(p.event.delta_p)} (${forMeWord(p.event.delta_p, 0.002)})` : null,
    sections: [
      { heading: 'P(you win the week)', lines: [`${pct(p.p_win_week)} · 80% band ${pctRange(p.lo, p.hi)}`, `Leader: ${leader(p.p_win_week, opp)}.`] },
      { heading: 'Category score at this moment', lines: [`You ${p.cats_lead.me} – ${p.cats_lead.opp} ${opp}.`] },
    ],
  };
}

function projectedSheet(ts: string, dn: Scenario | null, wm: Scenario | null, titles: Record<string, string>, cats: SeasonCategory[]): SheetContent {
  const d = dn?.points.find((x) => x.ts === ts) ?? null;
  const w = wm?.points.find((x) => x.ts === ts) ?? null;
  return {
    title: `${weekdayOf(etDate(ts))} ${etClock(ts)} · projected`,
    subtitle: 'If the moves due by then are made, and nothing after',
    effect: d && w ? `${forMeSymbol(w.p_win_week - d.p_win_week, 0.002)} With moves ${pct(w.p_win_week)} vs do nothing ${pct(d.p_win_week)}` : null,
    sections: [
      ...(d ? [{ heading: 'Do nothing', lines: [`${pct(d.p_win_week)} · 80% band ${pctRange(d.lo, d.hi)} · expected categories ${fixed(d.expected_cats, 1)}`] }] : []),
      ...(w
        ? [
            { heading: wm?.label ?? 'With moves', lines: [`${pct(w.p_win_week)} · 80% band ${pctRange(w.lo, w.hi)} · expected categories ${fixed(w.expected_cats, 1)}`] },
            { heading: 'Moves in effect by then', lines: w.moves_applied.length ? w.moves_applied.map((id) => titles[id] ?? id) : ['None yet: the first move is due later.'] },
            ...(w.cat_deltas.length ? [{ heading: 'Expected category changes vs do nothing', lines: [`${catDeltaLine(w.cat_deltas, cats, 4)} (pts of P(win category))`] }] : []),
          ]
        : []),
    ],
  };
}

function Compare({ data, rec }: { data: WinProbabilityResponse; rec: Scenario | null }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const c = PLAN[mode];
  const dn = data.scenarios.find((s) => s.kind === 'do_nothing') ?? null;
  const alts = data.scenarios.filter((s) => s.kind === 'custom');
  if (!alts.length) return <EmptyState title="No alternative plans">The engine sends up to 3 named alternatives when they are close to the recommended plan.</EmptyState>;
  const grid = (dn ?? rec ?? alts[0])!.points.map((p) => new Date(p.ts));
  return (
    <Stack spacing={1.25} sx={{ mt: 1 }}>
      {alts.slice(0, 3).map((alt) => {
        const lines = [
          ...(dn ? [{ s: dn, color: viz.neutral, dash: true }] : []),
          ...(rec ? [{ s: rec, color: c.rec, dash: false }] : []),
          { s: alt, color: c.alt, dash: false },
        ];
        return (
          <Box key={alt.scenario_id} component="section" aria-label={alt.label}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {alt.label}: {pct(alt.final.p_win_week)}{' '}
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                ({ptsDelta(alt.delta_vs_do_nothing)} vs do nothing{rec ? `; recommended ${pct(rec.final.p_win_week)}` : ''})
              </Box>
            </Typography>
            <LineChart
              height={120}
              skipAnimation
              hideLegend
              disableLineItemHighlight
              margin={{ left: 0, right: 52, top: 6, bottom: 0 }}
              xAxis={[{ scaleType: 'time', data: grid, valueFormatter: (v: Date) => weekdayOf(etDate(v.toISOString())), tickLabelStyle: { fontSize: 10, fill: viz.muted }, disableTicks: true, height: 18, tickNumber: 4 }]}
              yAxis={[{ id: 'f', min: 0, max: 1, tickInterval: [0, 0.5, 1], valueFormatter: mirrored, width: 26, disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 10, fill: viz.muted } }]}
              series={lines.map((l) => ({ id: l.s.scenario_id, data: l.s.points.map((p) => p.p_win_week), color: l.color, showMark: false, yAxisId: 'f' }))}
              sx={{
                [`& .${lineClasses.line}`]: { strokeWidth: 2 },
                ...(dn ? { [`& .${lineClasses.line}[data-series="${dn.scenario_id}"]`]: { strokeDasharray: '5 4' } } : {}),
              }}
            >
              <ChartsReferenceLine y={0.5} axisId="f" lineStyle={{ stroke: viz.axis, strokeDasharray: '5 4', strokeWidth: 1 }} />
              <EndLabels items={lines.map((l) => ({ id: l.s.scenario_id, value: l.s.final.p_win_week, text: pct(l.s.final.p_win_week), color: l.color }))} />
            </LineChart>
          </Box>
        );
      })}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Each panel: gray dashed = do nothing, blue = recommended plan, orange = the alternative.
      </Typography>
    </Stack>
  );
}

/**
 * Win probability over the week (MUI X LineChart, free). Past: actual P(win week)
 * snapshots, green while I am favored and red while the opponent is (piecewise colorMap at
 * 50% on its own y-axis). A "now" marker. Future: "Do nothing" (gray dashed) and "With
 * moves" (blue, with the engine's 80% band), each ending in its final value. Every number
 * is the engine's; toggling moves asks the engine for a new "With moves" scenario.
 */
export function WinProbabilityChart(props: WinProbabilityChartProps) {
  const { data, recomputing = false, moveTitles = {}, categories = data.week.categories, initialView = 'chart', metric = 'week', showPlan = true, milestones = [], onMilestone, hideTitle = false } = props;
  const isWeek = metric === 'week';
  const val = (p: { p_win_week: number; p_cats?: Partial<Record<CategoryKey, number>> } | undefined | null): number | null =>
    p == null ? null : isWeek ? p.p_win_week : (p.p_cats?.[metric as CategoryKey] ?? null);
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const planColor = PLAN[mode].rec;
  const [view, setView] = useState<'chart' | 'table' | 'compare'>(initialView);
  const [innerOpen, setInnerOpen] = useState<string | null>(null);
  const openTs = props.openTs !== undefined ? props.openTs : innerOpen;
  const setOpen = (t: string | null) => (props.onOpenTs ? props.onOpenTs(t) : setInnerOpen(t));

  const opp = data.opponent.name;
  const hist = data.history;
  const dn = data.scenarios.find((s) => s.kind === 'do_nothing') ?? null;
  const rec = data.scenarios.find((s) => s.kind === 'recommended') ?? null;
  const wm = showPlan ? (props.withMoves !== undefined ? props.withMoves : rec) : null;
  const cur = data.current;
  const now = hist[hist.length - 1] ?? null;

  const dnEnd = dn ? val(dn.points[dn.points.length - 1]) : null;
  const wmEnd = wm ? val(wm.points[wm.points.length - 1]) : null;
  const header = (
    <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        {!hideTitle && (
          <Typography variant="subtitle2" component="h2">
            {isWeek ? 'Win probability' : `${catLabel(metric as CategoryKey, categories)} win probability`}
          </Typography>
        )}
        {!isWeek && (
          <Typography variant="body1" className="tabular" sx={{ fontWeight: 700 }}>
            {catLabel(metric as CategoryKey, categories)} {pct(val(hist[hist.length - 1]))}
            {dnEnd != null && wmEnd != null && (
              <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary', fontSize: 14 }}>
                {' '}
                · by Sunday {pct(dnEnd)} → {pct(wmEnd)} with moves
              </Box>
            )}
          </Typography>
        )}
        {isWeek && cur && (
          <Typography variant="body1" className="tabular" sx={{ fontWeight: 700 }}>
            {leader(cur.p_win_week, opp)}
            {cur.delta_since_yesterday != null && (
              <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary', fontSize: 14 }}>
                {' '}
                · {forMeSymbol(cur.delta_since_yesterday, 0.002)} {ptsDelta(cur.delta_since_yesterday)} since yesterday
              </Box>
            )}
          </Typography>
        )}
      </Box>
    </Stack>
  );

  if (hist.length === 0) {
    return (
      <Box>
        {header}
        <Box sx={{ mt: 1 }}>
          <EmptyState title="No snapshots yet">The first one is taken after Monday’s nightly run.</EmptyState>
        </Box>
      </Box>
    );
  }

  // One shared timeline: snapshots, then the scenarios' common grid (its first point is "now").
  const futureTs = (dn ?? wm)?.points.map((p) => p.ts).filter((t) => t !== now?.ts) ?? [];
  const timeline = [...hist.map((h) => h.ts), ...futureTs];
  const at = (s: Scenario | null) => timeline.map((t) => val(s?.points.find((p) => p.ts === t)));
  const past = timeline.map((t) => val(hist.find((h) => h.ts === t)));
  const notable = new Set(hist.map((h, i) => (h.event && h.event.kind !== 'nightly' ? i : -1)).filter((i) => i >= 0));
  // Band drawing: a transparent lower area under a light (hi − lo) area. Geometry only; values are the engine's.
  const bandLo = timeline.map((t) => (isWeek ? (wm?.points.find((p) => p.ts === t)?.lo ?? null) : null));
  const bandH = timeline.map((t) => {
    const p = isWeek ? wm?.points.find((x) => x.ts === t) : undefined;
    return p ? Math.max(0, p.hi - p.lo) : null;
  });
  const milestoneItems = milestones
    .map((m) => {
      const before = [...hist].reverse().find((h) => h.ts <= m.ts) ?? hist[0];
      const v = val(before);
      return v == null ? null : { m, y: v };
    })
    .filter((x): x is { m: Milestone; y: number } => x != null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.start, i));
  const noons = days.map((d) => new Date(etMidnightMs(d) + 12 * 3_600_000));
  const ended = data.scenarios.length === 0;
  const endItems = [
    ...(dn && dnEnd != null ? [{ id: 'dn', value: dnEnd, text: pct(dnEnd), color: viz.neutral }] : []),
    ...(wm && wmEnd != null && !recomputing ? [{ id: 'wm', value: wmEnd, text: pct(wmEnd), color: planColor }] : []),
  ];

  let sheet: SheetContent | null = null;
  if (openTs) {
    const h = hist.find((x) => x.ts === openTs);
    sheet = h && (h !== now || ended || !wm) ? historySheet(h, opp) : projectedSheet(openTs, dn, wm, moveTitles, categories);
    if (h && h === now && !ended && wm) sheet = { ...historySheet(h, opp), sections: [...historySheet(h, opp).sections, ...projectedSheet(openTs, dn, wm, moveTitles, categories).sections.slice(0, 2)] };
  }

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>{header}</Box>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | 'compare' | null) => v && setView(v)} aria-label="Win probability view">
          <ToggleButton value="chart" sx={{ px: 1.1 }}>
            Chart
          </ToggleButton>
          {data.scenarios.some((s) => s.kind === 'custom') && (
            <ToggleButton value="compare" sx={{ px: 1.1 }}>
              Compare
            </ToggleButton>
          )}
          <ToggleButton value="table" sx={{ px: 1.1 }}>
            Table
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === 'chart' && (
        <>
          <Typography variant="caption" component="p" sx={{ mt: 0.75, fontWeight: 700, color: 'text.secondary' }}>
            ▲ You
          </Typography>
          <Box sx={{ position: 'relative' }}>
            <LineChart
              height={220}
              skipAnimation
              hideLegend
              disableLineItemHighlight
              grid={{ horizontal: true }}
              margin={{ left: 0, right: ended ? 10 : 54, top: 8, bottom: 0 }}
              xAxis={[
                {
                  scaleType: 'time',
                  data: timeline.map((t) => new Date(t)),
                  min: new Date(etMidnightMs(data.week.start)),
                  max: new Date(etMidnightMs(addDays(data.week.end, 1))),
                  tickInterval: noons,
                  valueFormatter: (v: Date) => weekdayOf(etDate(v.toISOString())),
                  disableTicks: true,
                  tickLabelStyle: { fontSize: 11, fill: viz.muted },
                  height: 22,
                },
              ]}
              yAxis={[
                {
                  id: 'p',
                  min: 0,
                  max: 1,
                  tickInterval: [0, 0.25, 0.5, 0.75, 1],
                  valueFormatter: mirrored,
                  width: 28,
                  disableTicks: true,
                  disableLine: true,
                  tickLabelStyle: { fontSize: 10, fill: viz.muted },
                  colorMap: { type: 'piecewise', thresholds: [0.5], colors: [fm.bad, fm.good] },
                },
                { id: 'f', min: 0, max: 1, position: 'none' },
              ]}
              series={[
                ...(wm ? [
                  { id: 'lo', data: bandLo, yAxisId: 'f', stack: 'band', area: true, showMark: false, color: planColor, disableHighlight: true },
                  { id: 'bandh', data: bandH, yAxisId: 'f', stack: 'band', area: true, showMark: false, color: planColor, disableHighlight: true },
                ] : []),
                ...(dn ? [{ id: 'dn', data: at(dn), yAxisId: 'f', showMark: false, color: viz.neutral, connectNulls: true, disableHighlight: true }] : []),
                ...(wm ? [{ id: 'wm', data: at(wm), yAxisId: 'f', showMark: false, color: planColor, connectNulls: true, disableHighlight: true }] : []),
                { id: 'past', data: past, yAxisId: 'p', curve: 'linear' as const, showMark: false },
              ]}
              onAxisClick={(_e, d) => {
                const t = d ? timeline[d.dataIndex] : undefined;
                if (t) setOpen(t);
              }}
              sx={{
                [`& .${lineClasses.line}`]: { strokeWidth: 2 },
                // Grid (drawn under the series): dashed hairlines at 25/75, a stronger dashed 50% midline.
                '& .MuiChartsGrid-line': { stroke: viz.grid, strokeDasharray: '3 4', strokeWidth: 1 },
                '& .MuiChartsGrid-line:nth-of-type(3)': { stroke: viz.axis, strokeDasharray: '5 4', strokeWidth: 1.5 },
                [`& .${lineClasses.line}[data-series="lo"], & .${lineClasses.line}[data-series="bandh"]`]: { stroke: 'none' },
                [`& .${lineClasses.area}[data-series="lo"]`]: { fill: 'transparent' },
                [`& .${lineClasses.area}[data-series="bandh"]`]: { fill: planColor, opacity: recomputing ? 0 : 0.12 },
                [`& .${lineClasses.line}[data-series="dn"]`]: { strokeDasharray: '5 4' },
                [`& .${lineClasses.line}[data-series="wm"]`]: { opacity: recomputing ? 0.3 : 1 },
              }}
            >
              {now && !ended && (
                <ChartsReferenceLine x={new Date(now.ts)} label="now" labelAlign="start" lineStyle={{ stroke: viz.muted, strokeWidth: 1 }} labelStyle={{ fontSize: 10, fill: viz.muted }} />
              )}
              {milestones.length === 0 && (
                <EventDots
                  points={hist
                    .filter((_h, i) => notable.has(i) || hist.length === 1)
                    .map((h) => ({ ts: h.ts, p: val(h) ?? h.p_win_week, color: (val(h) ?? 0.5) >= 0.5 ? fm.good : fm.bad }))}
                />
              )}
              <MilestoneDots items={milestoneItems} onPick={onMilestone} />
              {!ended && <EndLabels items={endItems} />}
            </LineChart>
            {recomputing && (
              <Box role="status" aria-live="polite" sx={{ position: 'absolute', right: 8, top: 8, display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'background.paper', boxShadow: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption">Recomputing…</Typography>
              </Box>
            )}
          </Box>
          <Typography variant="caption" component="p" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            ▼ {opp}
          </Typography>
          <Box aria-label="Legend" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, mt: 0.5, alignItems: 'center' }}>
            <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
              <Box aria-hidden sx={{ width: 14, height: 2, background: `linear-gradient(90deg, ${fm.good} 50%, ${fm.bad} 50%)` }} />
              Actual
            </Typography>
            {dn && (
              <Typography variant="caption" className="tabular" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                <Box aria-hidden sx={{ width: 14, height: 0, borderTop: `2px dashed ${viz.neutral}` }} />
                Do nothing {pct(dnEnd)}
              </Typography>
            )}
            {wm && (
              <Typography variant="caption" className="tabular" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.primary', fontWeight: 600 }}>
                <Box aria-hidden sx={{ width: 14, height: 2, bgcolor: planColor }} />
                {wm.kind === 'recommended' ? 'With moves' : wm.label} {recomputing ? '…' : pct(wmEnd)}
              </Typography>
            )}
            {wm && !recomputing && wm.delta_vs_do_nothing != null && (
              <Chip size="small" variant="outlined" label={`${forMeSymbol(wm.delta_vs_do_nothing, 0.002)} ${ptsDelta(wm.delta_vs_do_nothing)}`} sx={{ fontWeight: 700 }} />
            )}
          </Box>
          {!ended && dn && (
            <Typography variant="body2" component="p" sx={{ mt: 0.75 }}>
              If nothing changes, your odds stay near today&rsquo;s; the band shows how far the week could swing.
            </Typography>
          )}
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {ended ? 'The week is over.' : 'Projected lines show P(win week) if the moves due by each day are made. Shaded = 80% band.'} Dots = news, games final, lineup or transactions. Tap
            the chart for the nearest point.
          </Typography>
        </>
      )}

      {view === 'compare' && <Compare data={data} rec={rec} />}

      {view === 'table' && (
        <Table size="small" aria-label="Win probability" sx={{ mt: 0.5 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ px: 0.5 }}>When</TableCell>
              <TableCell align="right" sx={{ px: 0.5 }}>
                {ended ? 'P(win)' : 'Actual / do nothing'}
              </TableCell>
              {!ended && (
                <TableCell align="right" sx={{ px: 0.5 }}>
                  With moves
                </TableCell>
              )}
              <TableCell sx={{ px: 0.5 }}>Event</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {timeline.map((t) => {
              const h = hist.find((x) => x.ts === t);
              const d = dn?.points.find((x) => x.ts === t);
              const w = wm?.points.find((x) => x.ts === t);
              return (
                <TableRow key={t}>
                  <TableCell sx={{ px: 0.5 }} className="tabular">
                    {weekdayOf(etDate(t))} {etClock(t)}
                    {!h ? ' (proj.)' : ''}
                  </TableCell>
                  <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                    {pct(h?.p_win_week ?? d?.p_win_week ?? null)}
                  </TableCell>
                  {!ended && (
                    <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                      {w ? `${pct(w.p_win_week)} (${pctRange(w.lo, w.hi)})` : '—'}
                    </TableCell>
                  )}
                  <TableCell sx={{ px: 0.5 }}>{h?.event ? `${h.event.label} (${ptsDelta(h.event.delta_p)})` : '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {now && (
        <Typography variant="body2" className="tabular" sx={{ mt: 1, fontWeight: 600 }}>
          Categories now: You {now.cats_lead.me} – {now.cats_lead.opp} {opp}
          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
            {data.cats_as_of ? ` · live totals from Yahoo, ${weekdayOf(etDate(data.cats_as_of))} ${etClock(data.cats_as_of)}` : ' · live totals time unknown'}
          </Box>
        </Typography>
      )}
      {!ended && showPlan && wm == null && !recomputing && (
        <Alert severity="info" sx={{ mt: 1 }}>
          No moves selected: the plan line is the same as doing nothing.
        </Alert>
      )}
      <ProvenanceLine provenance={data.provenance} />
      <DetailSheet open={sheet != null} onClose={() => setOpen(null)} content={sheet} />
    </Box>
  );
}
