import type { DraftApi } from '../api/client';
import type { FantasyWeek, TeamDay, TeamWeeks, TeamWeeksResponse } from '../api/types';

/**
 * Join keys only. Player records carry Basketball Monster team codes, the schedule uses the
 * NBA/BallDontLie codes; two differ (DECISIONS.md, Phase D inputs). No numbers are derived here.
 */
const ALIASES: Record<string, string> = { NOR: 'NOP', PHO: 'PHX', GS: 'GSW', NO: 'NOP', SA: 'SAS', NY: 'NYK', UTAH: 'UTA', WSH: 'WAS' };

export function scheduleTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const a = abbr.toUpperCase();
  return ALIASES[a] ?? a;
}

export function teamWeeksFor(abbr: string | null | undefined, data: TeamWeeksResponse | null): TeamWeeks | null {
  const t = scheduleTeam(abbr);
  if (!t || !data) return null;
  return data.teams.find((x) => x.team === t) ?? null;
}

export function playoffWeeks(weeks: FantasyWeek[]): FantasyWeek[] {
  return weeks.filter((w) => w.is_playoff);
}

/** Week axis label; two-week periods get a "*" (their counts cover 14 days). */
export function weekLabel(w: FantasyWeek): string {
  return w.n_days > 7 ? `${w.week}*` : String(w.week);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Games per calendar month, counted from the API's day list (in season order). */
export function monthTotals(days: TeamDay[]): { month: string; key: string; games: number }[] {
  const counts = new Map<string, number>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, games]) => ({ key, games, month: MONTHS[Number(key.slice(5, 7)) - 1] ?? key }));
}

/** GET /schedule/team_days with one cached request per team and range (the schedule is fixed mid-draft). */
export function teamDaysLoader(api: Pick<DraftApi, 'getTeamDays'>): (team: string, start: string, end: string) => Promise<TeamDay[]> {
  const cache = new Map<string, Promise<TeamDay[]>>();
  return (team, start, end) => {
    const key = `${team}|${start}|${end}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = api.getTeamDays(team, start, end).then((r) => r.days);
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };
}
