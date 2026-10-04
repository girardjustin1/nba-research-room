import type {
  CategoryDelta,
  CategoryKey,
  Deadline,
  FeedItem,
  FeedKind,
  InjuryStatus,
  IsoDate,
  IsoDateTime,
  LineupDay,
  Move,
  PlayerRef,
  RosterSlot,
  SeasonCategory,
  SourceTier,
  ValueFormat,
  WaiverCandidate,
} from '../../api/season';
import { MISSING, ordinal, pct } from '../../lib/format';

/**
 * Display formatting and reshaping for the season screens. Nothing here estimates a
 * number: it prints values the engine returned, or regroups them for a view. Missing
 * values print as an em dash.
 */

const LEAGUE_TZ = 'America/New_York';
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A probability change as percentage points: 0.042 -> "+4.2 pts", -0.06 -> "−6.0 pts". */
export function ptsDelta(delta: number | null | undefined, digits = 1, unit = ' pts'): string {
  if (!isNum(delta)) return MISSING;
  const v = delta * 100;
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `±${s}${unit}`;
  return `${v > 0 ? '+' : '−'}${s}${unit}`;
}

/** Signed number with a real minus sign: 1.25 -> "+1.3", -2 -> "−2.0". */
export function signedNum(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return MISSING;
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `±${s}`;
  return `${v > 0 ? '+' : '−'}${s}`;
}

/** Engine band for a probability: (0.51, 0.65) -> "51–65%". */
export function pctRange(lo: number | null | undefined, hi: number | null | undefined): string {
  if (!isNum(lo) || !isNum(hi)) return MISSING;
  return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
}

/** Category stat value: ratios print as .478, counts as whole numbers or one decimal. */
export function statValue(v: number | null | undefined, isRatio: boolean, digits = 1): string {
  if (!isNum(v)) return MISSING;
  if (isRatio) return v.toFixed(3).replace(/^0(?=\.)/, '');
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

export function formatValue(v: number | null | undefined, format: ValueFormat): string {
  if (!isNum(v)) return MISSING;
  switch (format) {
    case 'prob':
      return pct(v);
    case 'prob_delta':
      return ptsDelta(v);
    case 'minutes':
      return `${v.toFixed(1)} min`;
    case 'percent':
      return `${(v * 100).toFixed(1)}%`;
    case 'count':
      return String(Math.round(v));
    case 'decimal':
      return v.toFixed(1);
    case 'signed':
      return signedNum(v);
    case 'rank':
      return ordinal(Math.round(v));
  }
}

/* --------------------------------------------------------------------- time */

function etParts(iso: IsoDateTime): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** League-time calendar date of a timestamp: "2026-11-18". */
export function etDate(iso: IsoDateTime): IsoDate {
  const p = etParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "7:00 pm" in league time. */
export function etClock(iso: IsoDateTime): string {
  const p = etParts(iso);
  return `${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toLowerCase()}`.trim();
}

/** "Wed" for a calendar date (no time-zone drift: the date is read as noon UTC). */
export function weekdayOf(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

/** "Nov 18" for a calendar date. */
export function shortDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "Nov 16–22" or "Feb 28–Mar 6". */
export function dateRange(start: IsoDate, end: IsoDate): string {
  const a = shortDate(start);
  const b = shortDate(end);
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a}–${b}`;
}

function dayDiff(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** "today 7:00 pm ET", "tomorrow 7:30 pm ET", "Fri 7:00 pm ET". */
export function whenLabel(iso: IsoDateTime, today: IsoDate): string {
  const d = etDate(iso);
  const diff = dayDiff(today, d);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : weekdayOf(d);
  return `${day} ${etClock(iso)} ET`;
}

/** Deadline line for a move: "Lock at 7:00 pm ET today", "Waiver clears Thu 3:00 am ET". */
export function deadlineLabel(deadline: Deadline, today: IsoDate): string {
  const d = etDate(deadline.at);
  const diff = dayDiff(today, d);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : weekdayOf(d);
  const time = `${etClock(deadline.at)} ET`;
  switch (deadline.kind) {
    case 'lineup_lock':
      return `Lock at ${time} ${day}`;
    case 'waiver_clears':
      return `Waiver clears ${day} ${time}`;
    case 'add_before_game':
      return `Add before ${day} ${time} (first game)`;
    case 'week_end':
      return `Week ends ${day} ${time}`;
  }
}

/** Relative age against the response's own clock: "just now", "12m ago", "3h ago", "Tue". */
export function ago(iso: IsoDateTime, nowIso: IsoDateTime): string {
  const mins = Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return weekdayOf(etDate(iso));
}

/** Time until a future timestamp: "in 25m", "in 3h", or the weekday. */
export function until(iso: IsoDateTime, nowIso: IsoDateTime): string {
  const mins = Math.round((Date.parse(iso) - Date.parse(nowIso)) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return weekdayOf(etDate(iso));
}

/** Epoch ms of 00:00 league time on a date (handles EST/EDT without a tz library). */
export function etMidnightMs(date: IsoDate): number {
  for (const off of ['-05:00', '-04:00']) {
    const ms = Date.parse(`${date}T00:00:00${off}`);
    const iso = new Date(ms).toISOString();
    if (etDate(iso) === date && etClock(iso) === '12:00 am') return ms;
  }
  return Date.parse(`${date}T00:00:00-05:00`);
}

/* -------------------------------------------------------- calendar dates */

const DAY = 86_400_000;
const toMs = (d: IsoDate) => Date.parse(`${d}T12:00:00Z`);
const fromMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

/** Monday on or before a date. */
export function mondayOf(date: IsoDate): IsoDate {
  const ms = toMs(date);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return fromMs(ms - dow * DAY);
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromMs(toMs(date) + n * DAY);
}

/** The Monday-first weeks (rows of 7 dates) that cover a calendar month "YYYY-MM". */
export function monthWeeks(month: string): IsoDate[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = fromMs(Date.UTC(y, m, 0, 12));
  const rows: IsoDate[][] = [];
  for (let d = mondayOf(first); toMs(d) <= toMs(last); d = addDays(d, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return rows;
}

/* ------------------------------------------------------------------- labels */

export function catLabel(key: CategoryKey, categories: SeasonCategory[]): string {
  return categories.find((c) => c.key === key)?.label ?? key;
}

/** "REB +6 · BLK +4 · PTS −3" (top `max` by |delta|, in pts of P(win category)). */
export function catDeltaLine(deltas: CategoryDelta[], categories: SeasonCategory[], max = 3): string {
  return [...deltas]
    .sort((a, b) => Math.abs(b.delta_p) - Math.abs(a.delta_p))
    .slice(0, max)
    .map((d) => `${catLabel(d.key, categories)} ${ptsDelta(d.delta_p, 0, '')}`)
    .join(' · ');
}

export const MOVE_KIND_LABEL: Record<Move['kind'], string> = { add_drop: 'ADD / DROP', start: 'START', bench: 'BENCH' };

/** "Add Callum Bramwell, drop Bram Venhaus" / "Start Isaac Pellham over Jalen Ferrante". */
export function moveTitle(move: Move): string {
  const c = move.counterpart?.name;
  switch (move.kind) {
    case 'add_drop':
      return c ? `Add ${move.player.name}, drop ${c}` : `Add ${move.player.name}`;
    case 'start':
      return c ? `Start ${move.player.name} over ${c}` : `Start ${move.player.name}`;
    case 'bench':
      return c ? `Bench ${move.player.name}, start ${c}` : `Bench ${move.player.name}`;
  }
}

export const STATUS_LABEL: Record<InjuryStatus, string> = {
  healthy: 'Healthy',
  probable: 'Probable',
  questionable: 'Questionable',
  doubtful: 'Doubtful',
  out: 'Out',
  day_to_day: 'Day-to-day',
  suspended: 'Suspended',
};

export const TIER_LABEL: Record<SourceTier, string> = {
  official: 'Official',
  insider: 'Insider',
  beat: 'Beat writer',
  aggregator: 'Aggregator',
};

/** "PG, SG" from eligibility, without Util/BN/IL. */
export function positionsLabel(eligible: RosterSlot[]): string {
  const shown = eligible.filter((s) => s === 'PG' || s === 'SG' || s === 'SF' || s === 'PF' || s === 'C');
  return shown.length ? shown.join(', ') : MISSING;
}

/** True when status should be called out (anything but healthy). */
export function hasStatusFlag(p: PlayerRef): boolean {
  return p.status.code !== 'healthy';
}

/* ---------------------------------------------------------------- reshaping */

export type FeedFilter = 'all' | FeedKind;

export function filterFeed(items: FeedItem[], filter: FeedFilter): FeedItem[] {
  return filter === 'all' ? items : items.filter((i) => i.kind === filter);
}

export function countByKind(items: FeedItem[]): Record<FeedFilter, number> {
  const out: Record<FeedFilter, number> = { all: items.length, news: 0, market: 0, model: 0, data: 0 };
  for (const i of items) out[i.kind] += 1;
  return out;
}

export type PositionFilter = 'all' | 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** Pickups filtered by eligibility and by a category the pickup helps; engine rank order is kept. */
export function filterWaivers(
  candidates: WaiverCandidate[],
  position: PositionFilter,
  category: CategoryKey | 'all',
): WaiverCandidate[] {
  return candidates
    .filter((c) => position === 'all' || c.player.eligible.includes(position))
    .filter((c) => category === 'all' || c.cats_helped.includes(category))
    .sort((a, b) => a.rank - b.rank);
}

export type GridCellState = 'start' | 'bench' | 'no_game' | 'out' | 'il';

export interface GridCell {
  date: IsoDate;
  state: GridCellState;
  /** Optimal slot when starting. */
  slot: RosterSlot | null;
  /** Current (do-nothing) slot, for the diff. */
  currentSlot: RosterSlot | null;
  currentState: GridCellState;
  /** Starts under the optimal lineup but not the current one, or the reverse. */
  changed: boolean;
  /** Starts either way, in a different slot (an eligibility shuffle). */
  moved: boolean;
  reason: string | null;
  opp: string | null;
  locked: boolean;
}

export interface GridRow {
  player: PlayerRef;
  cells: GridCell[];
  changes: number;
}

type Placement = { state: GridCellState; slot: RosterSlot | null; reason: string | null; opp: string | null; locked: boolean };

function placementIn(day: LineupDay, playerId: number, side: 'current' | 'optimal'): Placement {
  for (const s of day.slots) {
    const a = side === 'current' ? s.current : s.optimal;
    if (a.player?.player_id === playerId) {
      return {
        state: a.game ? 'start' : 'no_game',
        slot: s.slot,
        reason: s.changed ? s.reason : null,
        opp: a.game ? `${a.game.home ? 'vs' : '@'} ${a.game.opp_abbr}` : null,
        locked: a.locked,
      };
    }
  }
  const bench = side === 'current' ? day.bench_current : day.bench_optimal;
  const b = bench.find((x) => x.player?.player_id === playerId);
  if (b) {
    const out = b.player?.status.code === 'out' || b.player?.status.code === 'suspended';
    return {
      state: out ? 'out' : b.game ? 'bench' : 'no_game',
      slot: 'BN',
      reason: null,
      opp: b.game ? `${b.game.home ? 'vs' : '@'} ${b.game.opp_abbr}` : null,
      locked: b.locked,
    };
  }
  if (day.il.some((x) => x.player?.player_id === playerId)) {
    return { state: 'il', slot: 'IL', reason: null, opp: null, locked: false };
  }
  return { state: 'no_game', slot: null, reason: null, opp: null, locked: false };
}

/**
 * Per-player rows over the given days, from the optimizer's per-day slot assignments.
 * A cell is "changed" when he starts under one lineup and not the other, and "moved" when
 * he starts under both in different slots. Pure regrouping.
 */
export function buildLineupGrid(days: LineupDay[], roster: PlayerRef[]): GridRow[] {
  return roster.map((player) => {
    const cells = days.map<GridCell>((day) => {
      const opt = placementIn(day, player.player_id, 'optimal');
      const cur = placementIn(day, player.player_id, 'current');
      const startsDiffer = (opt.state === 'start') !== (cur.state === 'start');
      const slotDiffers = opt.state === 'start' && cur.state === 'start' && opt.slot !== cur.slot;
      return {
        date: day.date,
        state: opt.state,
        slot: opt.state === 'start' ? opt.slot : null,
        currentSlot: cur.slot,
        currentState: cur.state,
        changed: startsDiffer,
        moved: slotDiffers,
        reason: opt.reason ?? cur.reason,
        opp: opt.opp ?? cur.opp,
        locked: opt.locked,
      };
    });
    return { player, cells, changes: cells.filter((c) => c.changed).length };
  });
}

/** The cell's short label for the grid. */
export function cellLabel(cell: GridCell): string {
  switch (cell.state) {
    case 'start':
      return cell.slot ?? 'ST';
    case 'bench':
      return 'BN';
    case 'out':
      return 'OUT';
    case 'il':
      return 'IL';
    case 'no_game':
      return '–';
  }
}

/** The worst confidence level among items, for a section summary. */
export function worstLevel(levels: ('high' | 'medium' | 'low' | 'none')[]): 'high' | 'medium' | 'low' | 'none' {
  const order = ['none', 'low', 'medium', 'high'] as const;
  let worst = 3;
  for (const l of levels) worst = Math.min(worst, order.indexOf(l));
  return order[worst] ?? 'none';
}
