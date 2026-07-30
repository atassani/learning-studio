import { fetchJsonWithCache, JsonCacheStorage } from '../../src/app/fetchJsonWithCache';

const originalFetch = global.fetch;

function createStorage(initial: Record<string, string> = {}): JsonCacheStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

function createResponse(
  status: number,
  options: { body?: unknown; statusText?: string; etag?: string } = {}
): Response {
  return {
    status,
    statusText: options.statusText ?? '',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'etag' && options.etag ? options.etag : null),
    },
    json: async () => options.body,
  } as Response;
}

describe('fetchJsonWithCache', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retries without a stale ETag when a 304 has no cached JSON body', async () => {
    const url = '/studio-data/questions-log1-en.json';
    const storage = createStorage({
      [`data-etag:${url}`]: '"stale-etag"',
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(createResponse(304))
      .mockResolvedValueOnce(
        createResponse(200, {
          body: { questions: [{ number: 1 }] },
          etag: '"fresh-etag"',
        })
      );
    global.fetch = fetchMock;

    await expect(
      fetchJsonWithCache(url, storage, { maxAttempts: 3, baseDelayMs: 0 })
    ).resolves.toEqual({
      questions: [{ number: 1 }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      'If-None-Match': '"stale-etag"',
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({});
    expect(storage.get(`data-etag:${url}`)).toBe('"fresh-etag"');
  });

  it('does not retry a non-retryable 4xx response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(createResponse(404, { statusText: 'Not Found' }));
    global.fetch = fetchMock;

    await expect(
      fetchJsonWithCache('/studio-data/missing.json', createStorage(), {
        maxAttempts: 3,
        baseDelayMs: 0,
      })
    ).rejects.toThrow('Error 404: Not Found');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 5xx response', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(createResponse(503, { statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(createResponse(200, { body: { schemaVersion: 1 } }));
    global.fetch = fetchMock;

    await expect(
      fetchJsonWithCache('/studio-data/areas.json', createStorage(), {
        maxAttempts: 3,
        baseDelayMs: 0,
      })
    ).resolves.toEqual({ schemaVersion: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
