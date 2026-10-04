import type { ScheduleWeek, TeamWeekCounts } from '../../api/season';

/**
 * Regrouping for the Schedule volume grid. Counts are the schedule's; these only pick a
 * window of weeks, sort teams, and find the league median a cell is compared against.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export interface ScheduleWindow {
  key: string;
  label: string;
  weeks: ScheduleWeek[];
}

/** One window per calendar month a week starts in (regular season), plus "Playoffs". */
export function scheduleWindows(weeks: ScheduleWeek[]): ScheduleWindow[] {
  const out: ScheduleWindow[] = [];
  for (const w of weeks.filter((x) => !x.is_playoff)) {
    const key = monthKey(w.start);
    let win = out.find((o) => o.key === key);
    if (!win) {
      win = { key, label: MONTHS[Number(key.slice(5)) - 1] ?? key, weeks: [] };
      out.push(win);
    }
    win.weeks.push(w);
  }
  const po = weeks.filter((w) => w.is_playoff);
  if (po.length) out.push({ key: 'playoffs', label: 'Playoffs', weeks: po });
  return out;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Teams sorted by games in the window (most first), ties by abbreviation. */
export function sortTeamsByGames(teams: TeamWeekCounts[], weeks: ScheduleWeek[]): { team: string; sum: number }[] {
  return teams
    .map((t) => ({ team: t.team, sum: weeks.reduce((a, w) => a + (t.games_by_week[String(w.week)] ?? 0), 0) }))
    .sort((a, b) => b.sum - a.sum || a.team.localeCompare(b.team));
}
