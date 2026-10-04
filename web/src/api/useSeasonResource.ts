import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, ApiUnreachableError } from './client';
import type { Connection } from './useDraftRoom';

export interface SeasonResource<T> {
  data: T | null;
  connection: Connection;
  /** The last failure; the previous data stays on screen while it is set. */
  error: ApiError | ApiUnreachableError | Error | null;
  /** 409 from the engine: an input is missing and `error.message` says the next step. */
  notReady: string | null;
  loading: boolean;
  lastUpdated: number | null;
  refresh: () => void;
}

/** Season data changes on syncs and news, not per pick: poll every 30 s. */
export const SEASON_POLL_MS = 30_000;

/**
 * Polls one season endpoint like the draft room polls its session: one request at a time,
 * the last good data kept on failure, `connection` down only when the API is unreachable.
 */
export function useSeasonResource<T>(load: (signal: AbortSignal) => Promise<T>, pollMs = SEASON_POLL_MS): SeasonResource<T> {
  const [state, setState] = useState<Omit<SeasonResource<T>, 'refresh'>>({
    data: null,
    connection: 'connecting',
    error: null,
    notReady: null,
    loading: true,
    lastUpdated: null,
  });
  const inFlight = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    if (inFlight.current) return;
    const ctl = new AbortController();
    inFlight.current = ctl;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loadRef.current(ctl.signal);
      setState({ data, connection: 'up', error: null, notReady: null, loading: false, lastUpdated: Date.now() });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const notReady = err instanceof ApiError && err.status === 409 ? err.message : null;
      setState((s) => ({
        ...s,
        connection: err instanceof ApiUnreachableError ? 'down' : 'up',
        error: err instanceof Error ? err : new Error(String(err)),
        notReady,
        loading: false,
      }));
    } finally {
      inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    void run();
    const id = window.setInterval(() => void run(), pollMs);
    return () => {
      window.clearInterval(id);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [run, pollMs]);

  return { ...state, refresh: () => void run() };
}
