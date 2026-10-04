import { ApiError, ApiUnreachableError, messageFromBody, type FetchLike } from './client';

/**
 * GET helper for the season endpoints with the draft client's error semantics (imported,
 * not forked): ApiUnreachableError when the API or proxy is down, ApiError with FastAPI's
 * `detail` otherwise (a 409 carries a readable next step, e.g. "run `make nightly`").
 */
export function seasonGet<T>(baseUrl: string, path: string, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<T> {
  return seasonRequest<T>(baseUrl, 'GET', path, undefined, fetchImpl, signal);
}

export function seasonPost<T>(baseUrl: string, path: string, body: unknown, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<T> {
  return seasonRequest<T>(baseUrl, 'POST', path, body, fetchImpl, signal);
}

async function seasonRequest<T>(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiUnreachableError();
  }
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
    if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500) && parsed === null) throw new ApiUnreachableError();
    const { message, candidates } = messageFromBody(res.status, parsed);
    throw new ApiError(res.status, message, candidates);
  }
  if (parsed === null) throw new ApiError(res.status, 'The API returned an empty or non-JSON response');
  return parsed as T;
}

/** Query string from defined values only. */
export function query(params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `?${qs}` : '';
}
