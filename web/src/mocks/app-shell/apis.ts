import { createSeasonApi } from '../../api/season';
import { createSystemApi } from '../../api/system';
import type { FetchLike } from '../../api/client';
import type { AppApis } from '../../app/types';
import { createMockDraftApi } from '../draft/mockApi';

/** A fetch that never reaches a server: "API down" stories. */
export const unreachableFetch: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));

/** A fetch where every endpoint is "not implemented yet" (404): screens fall back to sample data. */
export const notFoundFetch: FetchLike = async () => new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });

/**
 * APIs for stories. The draft API serves the invented draft fixtures; season and system
 * calls are never made in mock mode (screens use the shared mocks directly).
 */
export function createMockApis(fetchImpl: FetchLike = notFoundFetch): AppApis {
  return { draft: createMockDraftApi(), season: createSeasonApi('/api', fetchImpl), system: createSystemApi('/api', fetchImpl) };
}
