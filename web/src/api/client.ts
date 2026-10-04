import type {
  ApiErrorBody,
  Board,
  CompareResponse,
  InsightsResponse,
  TeamDaysResponse,
  TeamWeeksResponse,
  PositionalValueResponse,
  TeamsResponse,
  HealthResponse,
  PickIn,
  PlayersResponse,
  RostersResponse,
  Session,
  SessionIn,
} from './types';

/** HTTP error from the draft API (4xx/5xx) with FastAPI's `detail` unpacked. */
export class ApiError extends Error {
  readonly status: number;
  readonly candidates: unknown[];

  constructor(status: number, message: string, candidates: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.candidates = candidates;
  }

  /** 409 "no draft session; POST /draft/session first" */
  get isNoSession(): boolean {
    return this.status === 409 && /no draft session/i.test(this.message);
  }

  /** 409 "set your draft slot first" */
  get isNoSlot(): boolean {
    return this.status === 409 && /draft slot/i.test(this.message);
  }

  /** 404: the running API does not have this endpoint yet (or the item is gone). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** The API could not be reached at all (not running, wrong port, proxy down). */
export class ApiUnreachableError extends Error {
  constructor(message = 'The draft API is not reachable') {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}

export function messageFromBody(status: number, body: unknown): { message: string; candidates: unknown[] } {
  const detail = (body as ApiErrorBody | null)?.detail;
  if (typeof detail === 'string') return { message: detail, candidates: [] };
  if (Array.isArray(detail)) {
    // FastAPI validation errors (422): [{loc, msg, type}]
    const first = detail[0] as { msg?: unknown } | undefined;
    return { message: typeof first?.msg === 'string' ? first.msg : 'Invalid request', candidates: [] };
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { error?: unknown; candidates?: unknown };
    const message = typeof d.error === 'string' ? d.error : JSON.stringify(detail);
    return { message, candidates: Array.isArray(d.candidates) ? d.candidates : [] };
  }
  return { message: `Request failed (HTTP ${status})`, candidates: [] };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DraftApi {
  health(): Promise<HealthResponse>;
  getSession(): Promise<Session>;
  startSession(body: SessionIn): Promise<Session>;
  setSlot(mySlot: number): Promise<Session>;
  setPunts(punts: string[]): Promise<Session>;
  getBoard(): Promise<Board>;
  getPlayers(opts?: { q?: string; availableOnly?: boolean; limit?: number }): Promise<PlayersResponse>;
  getRosters(): Promise<RostersResponse>;
  pick(body: PickIn): Promise<Session>;
  undo(): Promise<Session>;
  /** DELETE /draft/pick/{pick_no}: removes one pick (newer API). */
  removePick(pickNo: number): Promise<Session>;
  exportResults(): Promise<{ path: string }>;
  getTeams(): Promise<TeamsResponse>;
  setTeamNames(names: Record<string, string>): Promise<Session | TeamsResponse>;
  getPositionalValue(): Promise<PositionalValueResponse>;
  compare(ids: number[]): Promise<CompareResponse>;
  /** GET /draft/insights?last=N: the live read after each of the last N picks. */
  getInsights(last?: number): Promise<InsightsResponse>;
  /** GET /schedule/team_weeks: games per fantasy week for every NBA team. */
  getTeamWeeks(): Promise<TeamWeeksResponse>;
  /** GET /schedule/team_days: one team's game days in a date range. */
  getTeamDays(team: string, start: string, end: string): Promise<TeamDaysResponse>;
}

/**
 * Typed client for the local draft API. In the app the base is `/api` (Vite proxies it to
 * 127.0.0.1:8765); tests inject `fetchImpl`.
 */
export function createDraftApi(baseUrl = '/api', fetchImpl: FetchLike = (i, init) => fetch(i, init)): DraftApi {
  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiUnreachableError();
    }
    // The Vite proxy answers 502/504 (or 500 with an empty body) when the API is down.
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500) && parsed === null) {
        throw new ApiUnreachableError();
      }
      const { message, candidates } = messageFromBody(res.status, parsed);
      throw new ApiError(res.status, message, candidates);
    }
    if (parsed === null) throw new ApiError(res.status, 'The draft API returned an empty or non-JSON response');
    return parsed as T;
  }

  return {
    health: () => request('GET', '/health'),
    getSession: () => request('GET', '/draft/session'),
    startSession: (body) => request('POST', '/draft/session', body),
    setSlot: (mySlot) => request('PUT', '/draft/slot', { my_slot: mySlot }),
    setPunts: (punts) => request('PUT', '/draft/punts', { punts }),
    getBoard: () => request('GET', '/draft/board'),
    getPlayers: ({ q = '', availableOnly = true, limit = 300 } = {}) => {
      const params = new URLSearchParams({ q, available_only: String(availableOnly), limit: String(limit) });
      return request('GET', `/draft/players?${params.toString()}`);
    },
    getRosters: () => request('GET', '/draft/rosters'),
    pick: (body) => request('POST', '/draft/pick', { source: 'manual', ...body }),
    undo: () => request('POST', '/draft/undo'),
    exportResults: () => request('POST', '/draft/export'),
    removePick: (pickNo) => request('DELETE', `/draft/pick/${encodeURIComponent(String(pickNo))}`),
    getTeams: () => request('GET', '/draft/teams'),
    setTeamNames: (names) => request('PUT', '/draft/teams/names', { names }),
    getPositionalValue: () => request('GET', '/draft/positional_value'),
    getInsights: (last = 28) => request('GET', `/draft/insights?last=${last}`),
    getTeamWeeks: () => request('GET', '/schedule/team_weeks'),
    getTeamDays: (team, start, end) =>
      request('GET', `/schedule/team_days?${new URLSearchParams({ team, start, end }).toString()}`),
    compare: (ids) => request('GET', `/draft/compare?ids=${ids.map((i) => encodeURIComponent(String(i))).join(',')}`),
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof ApiUnreachableError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
