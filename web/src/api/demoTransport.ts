import type { FetchLike } from './client';
import type { FreeAgents, FreeAgentsRequest, MovesResponse, MyRoster, MyRosterRequest, NotificationsResponse, OpponentRoster, OpponentRosterRequest, ScenarioRequest, TeamNamesRequest } from './season';
import { createDraftApi } from './client';
import { createSeasonApi } from './season';
import { createSystemApi } from './system';
import type { AppApis } from '../app/types';
import { healthWarn, liveScoreboardNormal, modelsNormal, notesNormal, readinessWarn } from '../mocks/app-shell/system';
import { CATEGORIES, makeBoard, makeCompare, makeInsights, makePool, makePositional, makeStrength, makeTeams } from '../mocks/draft/fixtures';
import { demoSession, DemoPickError, initialDemoDraft, recordDemoPick, removeDemoPick, undoDemoPick, type DemoDraft } from '../mocks/draft/demoState';
import { SAMPLE_PLAYERS } from '../mocks/draft/players';
import { gcMidweekClose } from '../mocks/matchup-analysis/gamecenter';
import { mockScenarioEngine, probNormal } from '../mocks/matchup-analysis/probability';
import { weekNormal } from '../mocks/matchup-analysis/week';
import { notificationsNormal } from '../mocks/notifications/notifications';
import { yahooOff } from '../mocks/app-shell/yahooStatus';
import { opponentRosterFilled, sampleSave, sampleSaveNames, sampleSearch } from '../mocks/team-profiles/opponentRoster';
import { myRosterFilled, sampleFromDraft, sampleSaveMine } from '../mocks/team-profiles/myRoster';
import { freeAgentsFilled, sampleSaveFree } from '../mocks/team-profiles/freeAgents';
import { calendarBramwell } from '../mocks/player-profiles/calendar';
import { playerBramwell, playerHargreaveLastDay, playerPellham, playerRosswell } from '../mocks/player-profiles/player';
import { resultsNormal } from '../mocks/results/results';
import { lineupNormal } from '../mocks/team-builder/lineup';
import { movesNormal } from '../mocks/team-builder/moves';
import { waiversNormal } from '../mocks/team-builder/waivers';
import { compareAddDrop, compareStartSit } from '../mocks/team-player-analysis/compare';
import { feedNormal } from '../mocks/team-player-analysis/feed';
import { teamDaysNOP, teamWeeks } from '../mocks/team-profiles/schedule';
import { leagueTeamMe, leagueTeamOpponent, nbaTeamNOP } from '../mocks/team-profiles/teams';

/**
 * The demo build's API: a FetchLike that answers every endpoint the app calls from the SAME
 * shared mocks the stories use (src/mocks/<category>/), so the published prototype never
 * touches the network. Draft writes update an in-memory pick log (see mocks/draft/demoState);
 * engine numbers stay the sample values. Anything it cannot answer is recorded in
 * `unhandled` and returns 404 (the test suite asserts that list stays empty).
 */
export interface DemoTransport {
  fetch: FetchLike;
  /** "METHOD /path" for each request no handler matched. */
  unhandled: string[];
  /** Restore the starting demo draft. */
  reset(): void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = (m: { params: string[]; query: URLSearchParams; body: unknown; draft: DemoDraft }) => unknown;

const SEASON_PLAYERS = [playerBramwell, playerPellham, playerRosswell, playerHargreaveLastDay];

/** Demo state: "mark read" and the opponent entry stick until the demo is reset. */
interface DemoNotes {
  notes: NotificationsResponse;
  opponent: OpponentRoster;
  mine: MyRoster;
  free: FreeAgents;
}
const freshNotes = (): NotificationsResponse => JSON.parse(JSON.stringify(notificationsNormal)) as NotificationsResponse;

function markRead(state: DemoNotes, ids: string[]): { unread: number } {
  const items = state.notes.items.map((n) => (ids.length === 0 || ids.includes(n.id) ? { ...n, read: true } : n));
  state.notes = { ...state.notes, items, unread: items.filter((n) => !n.read).length };
  return { unread: state.notes.unread };
}

function routes(state: DemoNotes): [string, RegExp, Handler][] {
  return [
    // ---- health
    ['GET', /^\/health$/, () => ({ ok: true, session: 'demo-sample-draft' })],
    // ---- draft
    ['GET', /^\/draft\/session$/, ({ draft }) => demoSession(draft)],
    ['POST', /^\/draft\/session$/, ({ draft, body }) => {
      const b = (body ?? {}) as { my_slot?: number | null; punts?: string[] };
      if (b.my_slot) draft.mySlot = b.my_slot;
      if (b.punts) draft.punts = b.punts;
      return demoSession(draft);
    }],
    ['PUT', /^\/draft\/slot$/, ({ draft, body }) => {
      draft.mySlot = (body as { my_slot: number }).my_slot;
      return demoSession(draft);
    }],
    ['PUT', /^\/draft\/punts$/, ({ draft, body }) => {
      draft.punts = (body as { punts: string[] }).punts;
      return demoSession(draft);
    }],
    ['GET', /^\/draft\/board$/, ({ draft }) => {
      const s = demoSession(draft);
      return s.current_pick == null ? { complete: true, ...s } : makeBoard(s);
    }],
    ['GET', /^\/draft\/players$/, ({ draft, query }) => {
      const s = demoSession(draft);
      const q = (query.get('q') ?? '').toLowerCase();
      const all = query.get('available_only') === 'false';
      const taken = new Set(s.picks.map((p) => p.player_id));
      const list = all ? SAMPLE_PLAYERS.map((p) => ({ ...p, drafted: taken.has(p.player_id) })) : makePool(s);
      return { players: list.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, Number(query.get('limit') ?? 300)) };
    }],
    ['GET', /^\/draft\/rosters$/, ({ draft }) => {
      const s = demoSession(draft);
      return { teams: Object.fromEntries(Array.from({ length: s.teams }, (_, i) => [String(i + 1), s.picks.filter((p) => p.team_id === i + 1)])) };
    }],
    ['GET', /^\/draft\/teams$/, ({ draft }) => ({ teams: makeTeams(demoSession(draft)) })],
    ['PUT', /^\/draft\/teams\/names$/, ({ draft, body }) => {
      const names = (body as { names: Record<string, string> }).names;
      for (const [slot, name] of Object.entries(names)) {
        if (name.trim()) draft.names[slot] = name.trim();
        else delete draft.names[slot];
      }
      return demoSession(draft);
    }],
    ['GET', /^\/draft\/insights$/, ({ draft, query }) => {
      const s = demoSession(draft);
      return { insights: makeInsights(s, Number(query.get('last') ?? 28)), current_pick: s.current_pick, categories: CATEGORIES };
    }],
    ['GET', /^\/draft\/strength$/, ({ draft }) => makeStrength(demoSession(draft))],
    ['GET', /^\/draft\/positional_value$/, () => ({ positions: makePositional(), note: 'Sample values (demo).' })],
    ['GET', /^\/draft\/compare$/, ({ query }) => ({ players: makeCompare((query.get('ids') ?? '').split(',').map(Number).filter(Boolean)) })],
    ['POST', /^\/draft\/pick$/, ({ draft, body }) => {
      recordDemoPick(draft, (body ?? {}) as Parameters<typeof recordDemoPick>[1]);
      return demoSession(draft);
    }],
    ['DELETE', /^\/draft\/pick\/(\d+)$/, ({ draft, params }) => {
      removeDemoPick(draft, Number(params[0]));
      return demoSession(draft);
    }],
    ['POST', /^\/draft\/undo$/, ({ draft }) => {
      undoDemoPick(draft);
      return demoSession(draft);
    }],
    ['POST', /^\/draft\/export$/, () => ({ path: 'nowhere (demo mode writes nothing)' })],
    // ---- schedule (one answer for draft and season screens)
    ['GET', /^\/schedule\/team_weeks$/, () => teamWeeks],
    ['GET', /^\/schedule\/team_days$/, ({ query }) => {
      const team = (query.get('team') ?? '').toUpperCase();
      // Only NOP has invented game days; other teams answer with none (month totals hide).
      return team === 'NOP' ? teamDaysNOP : { team, days: [] };
    }],
    // ---- season
    ['GET', /^\/season\/lineup$/, () => lineupNormal],
    ['GET', /^\/season\/week$/, () => weekNormal],
    ['GET', /^\/season\/week\/gamecenter$/, () => gcMidweekClose],
    ['GET', /^\/season\/week\/probability$/, () => probNormal],
    ['POST', /^\/season\/scenario$/, ({ body }) => mockScenarioEngine(probNormal, (movesNormal as MovesResponse).moves, (body as ScenarioRequest).move_ids ?? [])],
    ['GET', /^\/season\/moves$/, () => movesNormal],
    ['GET', /^\/season\/feed$/, () => feedNormal],
    ['GET', /^\/season\/players\/(\d+)\/calendar$/, () => calendarBramwell],
    ['GET', /^\/season\/players\/(\d+)$/, ({ params }) => SEASON_PLAYERS.find((p) => p.player.player_id === Number(params[0])) ?? playerBramwell],
    ['GET', /^\/season\/compare$/, ({ query }) => (query.get('decision') === 'add_drop' ? compareAddDrop : compareStartSit)],
    ['GET', /^\/season\/waivers$/, () => waiversNormal],
    ['GET', /^\/season\/results$/, () => resultsNormal],
    ['GET', /^\/season\/notifications$/, () => state.notes],
    ['POST', /^\/season\/notifications\/read$/, ({ body }) => markRead(state, (body as { ids?: string[] } | undefined)?.ids ?? [])],
    ['GET', /^\/season\/league_teams\/(\d+)$/, ({ params }) => (Number(params[0]) === leagueTeamMe.team.team_id ? leagueTeamMe : leagueTeamOpponent)],
    ['GET', /^\/season\/nba_teams\/([A-Za-z]+)$/, () => nbaTeamNOP],
    ['GET', /^\/season\/opponent_roster$/, () => state.opponent],
    ['POST', /^\/season\/opponent_roster$/, ({ body }) => (state.opponent = sampleSave(state.opponent, body as OpponentRosterRequest))],
    ['GET', /^\/season\/player_search$/, ({ query }) => ({ players: sampleSearch(query.get('q') ?? '') })],
    ['GET', /^\/season\/my_roster$/, () => state.mine],
    ['POST', /^\/season\/my_roster\/from_draft$/, () => (state.mine = sampleFromDraft())],
    ['GET', /^\/season\/free_agents$/, () => state.free],
    ['POST', /^\/season\/free_agents$/, ({ body }) => (state.free = sampleSaveFree(body as FreeAgentsRequest))],
    ['POST', /^\/season\/my_roster$/, ({ body }) => (state.mine = sampleSaveMine(state.mine, body as MyRosterRequest))],
    ['POST', /^\/season\/league_team_names$/, ({ body }) => (state.opponent = sampleSaveNames(state.opponent, body as TeamNamesRequest))],
    // ---- system
    ['GET', /^\/system\/yahoo$/, () => yahooOff],
    ['GET', /^\/system\/health$/, () => healthWarn],
    ['GET', /^\/system\/readiness$/, () => readinessWarn],
    ['GET', /^\/system\/models$/, () => modelsNormal],
    ['GET', /^\/system\/scoreboard$/, () => liveScoreboardNormal],
    ['GET', /^\/system\/notes$/, () => notesNormal],
  ];
}

export function createDemoTransport(base = '/api'): DemoTransport {
  let draft = initialDemoDraft();
  const state: DemoNotes = { notes: freshNotes(), opponent: opponentRosterFilled, mine: myRosterFilled, free: freeAgentsFilled };
  const table = routes(state);
  const unhandled: string[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input, 'http://demo.invalid');
    const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? (JSON.parse(init.body) as unknown) : undefined;
    for (const [m, rx, handler] of table) {
      if (m !== method) continue;
      const hit = rx.exec(path);
      if (!hit) continue;
      try {
        return json(200, handler({ params: hit.slice(1), query: url.searchParams, body, draft }));
      } catch (err) {
        if (err instanceof DemoPickError) return json(409, { detail: err.message });
        if (err instanceof HttpError) return json(err.status, { detail: err.message });
        throw err;
      }
    }
    unhandled.push(`${method} ${path}`);
    return json(404, { detail: `demo: no sample data for ${method} ${path}` });
  };
  return {
    fetch: fetchImpl,
    unhandled,
    reset: () => {
      draft = initialDemoDraft();
      state.notes = freshNotes();
      state.opponent = opponentRosterFilled;
      state.mine = myRosterFilled;
      state.free = freeAgentsFilled;
    },
  };
}

/** All three APIs on one demo transport. */
export function createDemoApis(t: DemoTransport, base = '/api'): AppApis {
  return { draft: createDraftApi(base, t.fetch), season: createSeasonApi(base, t.fetch), system: createSystemApi(base, t.fetch) };
}
