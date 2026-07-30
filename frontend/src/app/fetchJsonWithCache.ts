export interface JsonCacheStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

interface FetchJsonWithCacheOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function fetchJsonWithCache(
  url: string,
  storage: JsonCacheStorage,
  options: FetchJsonWithCacheOptions = {}
): Promise<unknown> {
  const etagKey = `data-etag:${url}`;
  const cacheKey = `data-cache:${url}`;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  let attemptLimit = maxAttempts;
  let cachedEtag = storage.get(etagKey);
  let lastError: Error | null = null;
  let delayBeforeNextAttempt = false;
  let recoveredStaleConditionalRequest = false;

  for (let attempt = 0; attempt < attemptLimit; attempt++) {
    if (attempt > 0 && delayBeforeNextAttempt && baseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }

    const headers: HeadersInit = {};
    if (cachedEtag) {
      headers['If-None-Match'] = cachedEtag;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        cache: 'no-cache',
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
      delayBeforeNextAttempt = true;
      continue;
    }

    if (response.status === 304) {
      const cached = storage.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as unknown;
        } catch {
          storage.remove(cacheKey);
        }
      }

      storage.remove(etagKey);
      cachedEtag = null;
      lastError = new Error('Cached JSON missing for 304 response');
      delayBeforeNextAttempt = false;
      if (!recoveredStaleConditionalRequest) {
        recoveredStaleConditionalRequest = true;
        attemptLimit += 1;
      }
      continue;
    }

    if (!response.ok) {
      const responseError = new Error(`Error ${response.status}: ${response.statusText}`);
      if (response.status < 500) {
        throw responseError;
      }
      lastError = responseError;
      delayBeforeNextAttempt = true;
      continue;
    }

    const data = (await response.json()) as unknown;
    const cachedBodyStored = storage.set(cacheKey, JSON.stringify(data));
    const etag = response.headers?.get?.('ETag');
    if (etag && cachedBodyStored) {
      storage.set(etagKey, etag);
    } else {
      storage.remove(etagKey);
    }
    return data;
  }

  throw lastError ?? new Error('Failed to fetch after retries');
}
