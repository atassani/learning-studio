import { getLearningStateForAuthBootstrap } from '../../src/app/learningStateApi';

describe('learningStateApi bootstrap', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    localStorage.clear();
    sessionStorage.clear();
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns null instead of throwing when bootstrap fetch is unauthorized (401)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(getLearningStateForAuthBootstrap('global')).resolves.toBeNull();
  });
});
