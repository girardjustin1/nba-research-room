import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApis, createDemoTransport } from '../api/demoTransport';
import { AppFrame } from '../components/app-shell/AppFrame';
import { renderWithTheme } from '../test/render';
import { ROUTES } from './routes';

/**
 * The demo build must run fully offline: every manifest route loads on the demo transport,
 * no request reaches the real network, and no endpoint goes unanswered.
 */
describe('demo transport', () => {
  const realFetch = globalThis.fetch;
  let network: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    network = vi.fn(() => Promise.reject(new Error('network access in demo mode')));
    globalThis.fetch = network as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  for (const route of ROUTES) {
    it(`serves ${route.path} with no network and no unhandled endpoint`, async () => {
      const t = createDemoTransport();
      const hits: string[] = [];
      const counting = createDemoApis({
        ...t,
        fetch: (i, init) => {
          hits.push(`${init?.method ?? 'GET'} ${i}`);
          return t.fetch(i, init);
        },
      });
      renderWithTheme(<AppFrame path={route.path} navigate={() => {}} mode="live" apis={counting} demo={{ reset: t.reset }} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      expect(network).not.toHaveBeenCalled();
      expect(t.unhandled, `unhandled on ${route.path}: ${t.unhandled.join(', ')}`).toEqual([]);
      expect(hits.length, `${route.path} made no API calls`).toBeGreaterThan(0);
    });
  }

  it('records, removes, undoes picks and names teams in memory, and resets', async () => {
    const t = createDemoTransport();
    const { draft } = createDemoApis(t);
    const s0 = await draft.getSession();
    expect(s0.current_pick).toBe(30);
    const pool = (await draft.getPlayers({ availableOnly: true })).players;
    const s1 = await draft.pick({ player_id: pool[0]!.player_id });
    expect(s1.picks.find((p) => p.pick_no === 30)?.player_id).toBe(pool[0]!.player_id);
    expect(s1.current_pick).toBe(31);
    // Out of order (catching up) and the snake owner is checked like the real API.
    await draft.pick({ player_id: pool[1]!.player_id, pick_no: 40, team_id: 12 });
    await expect(draft.pick({ player_id: pool[2]!.player_id, pick_no: 41, team_id: 1 })).rejects.toThrow(/belongs to team/);
    await expect(draft.pick({ player_id: pool[0]!.player_id })).rejects.toThrow(/already drafted/);
    expect((await draft.removePick(40)).picks.some((p) => p.pick_no === 40)).toBe(false);
    expect((await draft.undo()).current_pick).toBe(30);
    await draft.setTeamNames({ '2': 'Renamed Sample Team' });
    expect((await draft.getSession()).team_names?.['2']).toBe('Renamed Sample Team');
    const insights = (await draft.getInsights()).insights;
    expect(insights.length).toBeGreaterThan(0);
    t.reset();
    const back = await draft.getSession();
    expect(back.current_pick).toBe(30);
    expect(back.team_names?.['2']).toBe('Fictional Five');
    expect(t.unhandled).toEqual([]);
  });

  it('answers a season scenario with the sample engine', async () => {
    const t = createDemoTransport();
    const { season } = createDemoApis(t);
    const r = await season.scenario({ move_ids: [] });
    expect(r).toHaveProperty('feasible');
    expect(t.unhandled).toEqual([]);
  });
});
