import { useCallback, useRef, useState } from 'react';
import { errorMessage } from './client';
import type { Scenario, ScenarioResponse } from './season';

export interface PlanState {
  selected: string[];
  /** The engine's scenario for the last feasible selection. */
  scenario: Scenario | null;
  recomputing: boolean;
  error: string | null;
  /** The engine said the current selection is not allowed (e.g. "Uses 5 of 4 acquisitions"). */
  infeasible: string | null;
  /** Moves the engine says cannot be added to the selection, with its reason. */
  incompatible: Record<string, string>;
}

/**
 * Toggling a move sends the whole selection to the engine (POST /season/scenario) and
 * redraws from its answer. The browser never computes a probability. Only the latest
 * request's answer is applied, so fast toggles cannot show a stale line.
 */
export function useScenarioPlan(
  send: (moveIds: string[]) => Promise<ScenarioResponse>,
  initialSelected: string[],
  initialScenario: Scenario | null,
  initialIncompatible: Record<string, string> = {},
) {
  const [state, setState] = useState<PlanState>({
    selected: initialSelected,
    scenario: initialScenario,
    recomputing: false,
    error: null,
    infeasible: null,
    incompatible: initialIncompatible,
  });
  const seq = useRef(0);

  const apply = useCallback(
    (selected: string[]) => {
      const id = (seq.current += 1);
      setState((s) => ({ ...s, selected, recomputing: true, error: null }));
      send(selected).then(
        (r) => {
          if (id !== seq.current) return;
          const incompatible = Object.fromEntries(r.incompatible.map((x) => [x.move_id, x.reason]));
          setState((s) =>
            r.feasible
              ? { ...s, scenario: r.scenario, recomputing: false, infeasible: null, incompatible }
              : { ...s, recomputing: false, infeasible: r.message ?? 'The engine rejected this combination', incompatible },
          );
        },
        (err) => {
          if (id !== seq.current) return;
          setState((s) => ({ ...s, recomputing: false, error: errorMessage(err) }));
        },
      );
    },
    [send],
  );

  const toggle = useCallback(
    (moveId: string) => {
      const next = state.selected.includes(moveId) ? state.selected.filter((m) => m !== moveId) : [...state.selected, moveId];
      apply(next);
    },
    [state.selected, apply],
  );

  return { state, toggle, retry: () => apply(state.selected) };
}
