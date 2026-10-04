import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioResponse } from './season';
import { useScenarioPlan } from './useScenarioPlan';

const sc = (id: string): Scenario => ({ scenario_id: id, label: id, kind: 'custom', move_ids: [], points: [], final: { p_win_week: 0.5, lo: 0.4, hi: 0.6, expected_cats: 4.5 }, delta_vs_do_nothing: 0 });

describe('useScenarioPlan', () => {
  it('applies only the latest answer and keeps the last good line on rejection', async () => {
    const pending: ((r: ScenarioResponse) => void)[] = [];
    const send = () => new Promise<ScenarioResponse>((res) => pending.push(res));
    const { result } = renderHook(() => useScenarioPlan(send, ['a'], sc('start')));
    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('c'));
    expect(result.current.state.recomputing).toBe(true);
    act(() => pending[1]!({ scenario: sc('latest'), feasible: true, message: null, solve_ms: 1, incompatible: [] }));
    act(() => pending[0]!({ scenario: sc('stale'), feasible: true, message: null, solve_ms: 1, incompatible: [] }));
    await waitFor(() => expect(result.current.state.scenario?.scenario_id).toBe('latest'));
    expect(result.current.state.selected).toEqual(['a', 'b', 'c']);
    act(() => result.current.toggle('d'));
    act(() => pending[2]!({ scenario: null, feasible: false, message: 'Uses 5 of 4 acquisitions', solve_ms: 1, incompatible: [{ move_id: 'e', reason: 'cap' }] }));
    await waitFor(() => expect(result.current.state.infeasible).toBe('Uses 5 of 4 acquisitions'));
    expect(result.current.state.scenario?.scenario_id).toBe('latest');
    expect(result.current.state.incompatible).toEqual({ e: 'cap' });
  });
  it('reports a failed request as an error', async () => {
    const { result } = renderHook(() => useScenarioPlan(() => Promise.reject(new Error('boom')), [], null));
    act(() => result.current.toggle('a'));
    await waitFor(() => expect(result.current.state.error).toBe('boom'));
    expect(result.current.state.recomputing).toBe(false);
  });
});
