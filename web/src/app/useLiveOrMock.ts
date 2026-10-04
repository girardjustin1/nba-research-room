import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, ApiUnreachableError, errorMessage } from '../api/client';

export type DataMode = 'live' | 'mock';

export interface LiveOrMock<T> {
  data: T | null;
  /** True when the data is invented (mock mode, or the endpoint is not implemented: 404). */
  isMock: boolean;
  loading: boolean;
  error: string | null;
  /** 409 from the engine: an input is missing; the message says the next step. */
  notReady: string | null;
  down: boolean;
  refresh: () => void;
}

/**
 * Live data when the endpoint exists; the shared story mock (marked isMock) when the API
 * answers 404 or in mock mode. Other failures surface as errors, never as invented numbers.
 */
export function useLiveOrMock<T>(load: () => Promise<T>, mock: T, mode: DataMode): LiveOrMock<T> {
  const [state, setState] = useState<Omit<LiveOrMock<T>, 'refresh'>>(() =>
    mode === 'mock'
      ? { data: mock, isMock: true, loading: false, error: null, notReady: null, down: false }
      : { data: null, isMock: false, loading: true, error: null, notReady: null, down: false },
  );
  const loadRef = useRef(load);
  const mockRef = useRef(mock);
  useEffect(() => {
    loadRef.current = load;
    mockRef.current = mock;
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (mode === 'mock') return;
    let live = true;
    loadRef.current().then(
      (data) => live && setState({ data, isMock: false, loading: false, error: null, notReady: null, down: false }),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.isNotFound) {
          setState({ data: mockRef.current, isMock: true, loading: false, error: null, notReady: null, down: false });
        } else if (err instanceof ApiError && err.status === 409) {
          setState({ data: null, isMock: false, loading: false, error: null, notReady: err.message, down: false });
        } else {
          setState((s) => ({ ...s, loading: false, error: errorMessage(err), down: err instanceof ApiUnreachableError }));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [mode, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}
