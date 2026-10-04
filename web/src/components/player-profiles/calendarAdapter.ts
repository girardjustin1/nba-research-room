import type { CalendarDay, CalendarMetric, CalendarMetricOption, PlayerCalendarResponse, TeamDaysResponse, TeamWeeksResponse } from '../../api/season';
import { ordinal, pct } from '../../lib/format';
import type { SheetSection } from '../foundations/DetailSheet';
import type { HeatDay, HeatScaleSpec } from '../foundations/HeatCalendar';
import { STATUS_LABEL, addDays, mondayOf, shortDate, signedNum, weekdayOf } from '../foundations/seasonFormat';

/**
 * Turns engine calendar days into heat-calendar cells for one metric, and writes the
 * bottom-sheet text from the engine's numbers. Display only: nothing is estimated here.
 */

/** Whose player this is, so out / DNP / game days are colored from MY side. */
export type Perspective = 'mine' | 'opponent' | 'neutral';

const SIDE: Record<Perspective, number> = { mine: 1, opponent: -1, neutral: 0 };

export function metricValue(day: CalendarDay, opt: CalendarMetricOption): number | null {
  if (day.state === 'scheduled') return day.projected?.[opt.key]?.mean ?? null;
  if (day.state !== 'played') return null;
  if (opt.field === 'value') return day.value;
  if (opt.field === 'z') return day.z?.[opt.key as keyof NonNullable<CalendarDay['z']>] ?? null;
  return day.stats?.[opt.key as keyof NonNullable<CalendarDay['stats']>] ?? null;
}

function fmt(v: number | null, opt: CalendarMetricOption, projected: boolean): string | null {
  if (v == null) return null;
  const s = opt.signed ? signedNum(v) : projected ? v.toFixed(1) : String(Math.round(v));
  return projected ? `~${s}` : s;
}

export function scaleFor(opt: CalendarMetricOption): HeatScaleSpec {
  const f = (v: number) => (opt.signed ? signedNum(v) : String(Math.round(v)));
  if (opt.signed) {
    return {
      kind: 'diverging',
      min: opt.domain.min,
      max: opt.domain.max,
      label: opt.key === 'value' ? 'Value: sum of 9 category z-scores (TO negative)' : `${opt.label} (volume-weighted, z)`,
      lowLabel: 'hurts',
      highLabel: 'helps',
      format: f,
    };
  }
  return {
    kind: 'sequential',
    min: opt.domain.min,
    max: opt.domain.max,
    label: `${opt.label} per game${opt.higher_is_better ? '' : ' (more is worse)'}`,
    lowLabel: 'fewer',
    highLabel: 'more',
    format: f,
  };
}

function statLine(d: CalendarDay): string {
  const s = d.stats;
  if (!s) return '';
  const parts = [`${s.pts ?? 0} PTS`, `${s.reb ?? 0} REB`, `${s.ast ?? 0} AST`, `${s.stl ?? 0} ST`, `${s.blk ?? 0} BLK`, `${s.fg3m ?? 0} 3PTM`, `${s.tov ?? 0} TO`];
  return parts.join(' · ');
}

function scheduleLines(d: CalendarDay, resp: PlayerCalendarResponse, currentWeek: number | null): string[] {
  const out: string[] = [];
  if (d.back_to_back) out.push('Second night of a back-to-back.');
  if (d.light_day) out.push('Light day: 5 or fewer NBA games.');
  if (d.cup_or_playoff_week === 'nba_cup') out.push('NBA Cup night.');
  if (d.cup_or_playoff_week === 'playoffs') out.push('Fantasy playoff week.');
  if (d.my_open_slots != null) out.push(`Your open slots he fits that day: ${d.my_open_slots}${d.my_open_slots === 0 ? ' (he would sit unless he beats a starter)' : ''}.`);
  if (d.week != null && d.week === currentWeek && d.state !== 'no_game') out.push(`Games left this week: ${resp.games_left_this_week}.`);
  return out;
}

export function calendarToHeatDays(resp: PlayerCalendarResponse, metric: CalendarMetric, currentWeek: number | null, perspective: Perspective = 'mine'): HeatDay[] {
  const opt = resp.metric_options.find((o) => o.key === metric) ?? resp.metric_options[0]!;
  const side = SIDE[perspective];
  return resp.days.map((d) => {
    const v = metricValue(d, opt);
    const game = d.opponent ? `${d.home ? 'vs' : '@'} ${d.opponent}${d.home ? ' (home)' : ' (away)'}` : 'No game';
    const sections: SheetSection[] = [];
    if (d.state === 'played') {
      sections.push({
        heading: 'What happened',
        lines: [
          `Played ${d.minutes ?? '—'} minutes.`,
          statLine(d),
          ...(d.stats?.fga != null ? [`Shooting ${d.stats.fgm ?? 0}/${d.stats.fga} FG, ${d.stats.ftm ?? 0}/${d.stats.fta ?? 0} FT.`] : []),
          `${opt.label}: ${fmt(v, opt, false) ?? '—'}${opt.key !== 'value' && d.value != null ? ` · Value ${signedNum(d.value)} (sum of z)` : ''}.`,
        ],
      });
    } else if (d.state === 'scheduled') {
      const p = d.projected?.[opt.key];
      const val = d.projected?.value;
      sections.push({
        heading: 'Projection',
        lines: [
          p ? `${opt.label}: ${opt.signed ? signedNum(p.mean) : p.mean.toFixed(1)} ± ${p.sd.toFixed(1)} (mean ± sd).` : `No projection for ${opt.label}.`,
          ...(opt.key !== 'value' && val ? [`Value: ${signedNum(val.mean)} ± ${val.sd.toFixed(1)}.`] : []),
          `Chance he plays: ${d.play_prob == null ? 'unknown' : pct(d.play_prob)} · ${d.confidence.level} confidence.`,
          ...d.confidence.missing.map((m) => `Missing: ${m.label}.`),
        ],
      });
    } else if (d.state === 'dnp') {
      sections.push({ heading: 'Did not play', lines: [`His team played; he did not. ${d.status_note ?? ''}`.trim()] });
    } else if (d.state === 'out') {
      sections.push({ heading: STATUS_LABEL.out, lines: [d.status_note ?? 'Ruled out.'] });
    } else {
      sections.push({ heading: 'No game', lines: ['His team does not play this day.'] });
    }
    if (d.opp_context) {
      const { pace_rank, def_rank } = d.opp_context;
      sections.push({
        heading: 'Opponent',
        lines: [`${d.opponent}: pace ${pace_rank ? ordinal(pace_rank) : '—'} of 30, defense ${def_rank ? ordinal(def_rank) : '—'} of 30 (1 = fastest / best).`],
      });
    }
    const sched = scheduleLines(d, resp, currentWeek);
    if (sched.length) sections.push({ heading: 'Schedule', lines: sched });
    if (d.notes.length) sections.push({ heading: 'Why it matters for your week', lines: d.notes });
    return {
      date: d.date,
      state: d.state,
      value: v,
      tableValue: fmt(v, opt, d.state === 'scheduled'),
      // A missed game hurts me if he is mine, helps me if he is my opponent's.
      effect: d.state === 'out' || d.state === 'dnp' ? -side : null,
      markers: {
        today: d.date === resp.today,
        light: d.light_day,
        b2b: d.back_to_back,
        cup: d.cup_or_playoff_week === 'nba_cup',
        playoffs: d.cup_or_playoff_week === 'playoffs',
      },
      sheet: { title: `${weekdayOf(d.date)} ${shortDate(d.date)}${d.date === resp.today ? ' · today' : ''}`, subtitle: game, sections },
    };
  });
}

/**
 * A team's days as game / no-game cells, with weeks of 4+ games marked from the engine's
 * per-week counts (/schedule/team_weeks).
 */
export function teamDaysToHeatDays(
  days: TeamDaysResponse,
  weeks: TeamWeeksResponse,
  from: string,
  to: string,
  today: string,
  perspective: Perspective = 'mine',
): HeatDay[] {
  const side = SIDE[perspective];
  const counts = weeks.teams.find((t) => t.team === days.team)?.games_by_week ?? {};
  const byDate = new Map(days.days.map((d) => [d.date, d]));
  const out: HeatDay[] = [];
  for (let date = mondayOf(from); date <= to; date = addDays(date, 1)) {
    const g = byDate.get(date);
    const w = weeks.weeks.find((x) => date >= x.start && date <= x.end);
    const wk = w ? (counts[String(w.week)] ?? null) : null;
    const four = wk != null && w != null && w.n_days === 7 && wk >= 4;
    const lines: string[] = [
      w ? `Week ${w.week}${w.n_days === 14 ? ' (14 days)' : ''}: ${wk ?? '—'} games for ${days.team}${w.is_playoff ? ', a fantasy playoff week' : ''}.` : 'Outside the fantasy season.',
    ];
    if (g?.back_to_back) lines.push('Second night of a back-to-back.');
    if (g?.light_day) lines.push('Light day: fewer teams compete for your open slots.');
    out.push({
      date,
      state: g ? 'game' : 'no_game',
      value: null,
      tableValue: g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : null,
      // A game day for my player's team is a game for me; for an opponent's, a game against me.
      effect: g ? side : null,
      markers: { today: date === today, light: !!g?.light_day, b2b: !!g?.back_to_back, playoffs: !!w?.is_playoff, fourGameWeek: four },
      sheet: {
        title: `${weekdayOf(date)} ${shortDate(date)}${date === today ? ' · today' : ''}`,
        subtitle: g ? `${days.team} ${g.home ? 'vs' : '@'} ${g.opponent}` : `${days.team}: no game`,
        sections: [{ heading: 'Schedule', lines }],
      },
    });
  }
  return out;
}
