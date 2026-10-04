import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiUnreachableError, createDraftApi, type FetchLike } from './client';

function respond(status: number, body: unknown): FetchLike {
  return vi.fn(async () => new Response(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

describe('draft API client', () => {
  it('returns parsed JSON on success and calls the /api-prefixed path', async () => {
    const fetchImpl = respond(200, { ok: true, session: null });
    const api = createDraftApi('/api', fetchImpl);
    await expect(api.health()).resolves.toEqual({ ok: true, session: null });
    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('turns a 409 string detail into an ApiError with the message', async () => {
    const api = createDraftApi('/api', respond(409, { detail: 'pick 5 is already recorded' }));
    const err = await api.pick({ player_id: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe('pick 5 is already recorded');
  });

  it('recognises the no-session and no-slot 409s', async () => {
    const noSession = await createDraftApi('/api', respond(409, { detail: 'no draft session; POST /draft/session first' }))
      .getSession()
      .then(() => null, (e: unknown) => e as ApiError);
    expect(noSession?.isNoSession).toBe(true);
    const noSlot = await createDraftApi('/api', respond(409, { detail: 'set your draft slot first (PUT /draft/slot)' }))
      .getBoard()
      .then(() => null, (e: unknown) => e as ApiError);
    expect(noSlot?.isNoSlot).toBe(true);
    expect(noSlot?.isNoSession).toBe(false);
  });

  it('unpacks {error, candidates} detail for an unmatched name', async () => {
    const api = createDraftApi(
      '/api',
      respond(409, { detail: { error: "could not match 'Sample X' (ambiguous)", candidates: [{ id: 1 }, { id: 2 }] } }),
    );
    const err = (await api.pick({ player_name: 'Sample X' }).catch((e: unknown) => e)) as ApiError;
    expect(err.message).toContain('could not match');
    expect(err.candidates).toHaveLength(2);
  });

  it('reads the first message of a 422 validation error', async () => {
    const api = createDraftApi('/api', respond(422, { detail: [{ loc: ['body', 'my_slot'], msg: 'Input should be a valid integer' }] }));
    const err = (await api.setSlot(Number.NaN).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(422);
    expect(err.message).toBe('Input should be a valid integer');
  });

  it('reports a network failure as unreachable', async () => {
    const api = createDraftApi('/api', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.getSession()).rejects.toBeInstanceOf(ApiUnreachableError);
  });

  it('reports a proxy 502/500 with no JSON body as unreachable', async () => {
    await expect(createDraftApi('/api', respond(502, '')).getSession()).rejects.toBeInstanceOf(ApiUnreachableError);
    await expect(createDraftApi('/api', respond(500, '')).getSession()).rejects.toBeInstanceOf(ApiUnreachableError);
  });

  it('keeps a 500 that has a JSON detail as an ApiError', async () => {
    await expect(createDraftApi('/api', respond(500, { detail: 'boom' })).getBoard()).rejects.toBeInstanceOf(ApiError);
  });

  it('sends manual picks as JSON with source=manual', async () => {
    const fetchImpl = respond(200, { draft_id: 'x' });
    await createDraftApi('/api', fetchImpl).pick({ player_id: 42, team_id: 3 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/draft/pick');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ source: 'manual', player_id: 42, team_id: 3 });
  });

  it('builds the players query string', async () => {
    const fetchImpl = respond(200, { players: [] });
    await createDraftApi('/api', fetchImpl).getPlayers({ q: 'sample guard', limit: 50 });
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('/api/draft/players?q=sample+guard&available_only=true&limit=50');
  });
});
