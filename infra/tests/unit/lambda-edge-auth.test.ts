describe('Cognito JWT validation', () => {
  beforeAll(() => {
    process.env.EDGE_AUTH_CONFIG_PATH = path.join(os.tmpdir(), 'edge-auth-config-missing.json');
    process.env.NEXT_PUBLIC_AWS_REGION = 'eu-west-2';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'test-pool';

    // Patch jose mock to accept the simulated Cognito JWT
    const jose = require('jose');
    jose.jwtVerify.mockImplementation(async (token: any, jwks: any, options: any) => {
      if (token === 'eyJraWQiOiJr...validtoken...') {
        return { payload: { sub: 'google-user', iss: options.issuer } };
      }
      throw new Error('Invalid token');
    });
  });
  it('should validate a Cognito JWT (simulated)', async () => {
    // Simulate a Cognito JWT cookie
    const validCognitoJwt = 'jwt=eyJraWQiOiJr...validtoken...';
    const result = await authModule.isValidJWT(validCognitoJwt);
    expect(result).toBe(true);
  });
});
// Mock jose imports to avoid Jest ES module parse error
jest.mock('jose', () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
}));
// infra/test/lambda-edge-auth.test.ts
// Jest test scaffold for Lambda@Edge authentication handler

import * as authModule from '../../main/lambda-edge-auth';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Lambda@Edge Auth Handler', () => {
  beforeEach(() => {
    process.env.EDGE_AUTH_CONFIG_PATH = path.join(os.tmpdir(), 'edge-auth-config-missing.json');
    authModule.setLearningStateStoreImpl(null);
  });

  function makeEvent({
    uri,
    cookie,
    method = 'GET',
    querystring = '',
    acceptLanguage,
    body,
  }: {
    uri: string;
    cookie?: string;
    method?: string;
    querystring?: string;
    acceptLanguage?: string;
    body?: { data: string; encoding?: 'base64' | 'text' };
  }) {
    const headers: Record<string, Array<{ key: string; value: string }>> = {};
    if (cookie) {
      headers.cookie = [{ key: 'Cookie', value: cookie }];
    }
    if (acceptLanguage) {
      headers['accept-language'] = [{ key: 'Accept-Language', value: acceptLanguage }];
    }
    return {
      Records: [
        {
          cf: {
            request: {
              uri,
              method,
              querystring,
              headers,
              ...(body ? { body: { data: body.data, encoding: body.encoding ?? 'text' } } : {}),
            },
          },
        },
      ],
    };
  }

  it('should redirect unauthenticated requests to OAuth login', async () => {
    const event = makeEvent({ uri: '/studio/app', cookie: undefined });
    const result = await authModule.handler(event as any);
    // Type guard for CloudFrontResultResponse
    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toContain('/studio/login');
    } else {
      throw new Error('Expected a redirect response');
    }
  });

  it('should allow access with valid JWT/cookie', async () => {
    const event = makeEvent({ uri: '/studio/secure', cookie: 'jwt=valid' });
    const result = await authModule.handler(event as any);
    // Type guard for CloudFrontRequest
    if (result && 'uri' in result) {
      expect(result.uri).toBe('/secure/index.html');
    } else {
      throw new Error('Expected request to be allowed');
    }
  });

  it('should allow guest access for /studio/guest', async () => {
    const event = makeEvent({ uri: '/studio/guest', cookie: undefined });
    const result = await authModule.handler(event as any);
    if (result && 'uri' in result) {
      expect(result.uri).toBe('/guest/index.html');
    } else {
      throw new Error('Expected guest request to be allowed');
    }
  });

  it('should rewrite studio routes to index.html for SPA', async () => {
    const event = makeEvent({ uri: '/studio/login', cookie: undefined });
    const result = await authModule.handler(event as any);
    if (result && 'uri' in result) {
      expect(result.uri).toBe('/login/index.html');
    } else {
      throw new Error('Expected request to be allowed');
    }
  });

  it('should return studio 404 for unsupported language entrypoint', async () => {
    const event = makeEvent({ uri: '/studio/fr', cookie: undefined });
    const result = await authModule.handler(event as any);
    if (result && 'status' in result) {
      expect(result.status).toBe('404');
      expect(result.headers?.['content-type']?.[0]?.value).toContain('text/html');
      expect(result.body).toContain('<h1>404</h1>');
      expect(result.body).toContain('lang="');
    } else {
      throw new Error('Expected a 404 response');
    }
  });

  it('should localize studio 404 using Accept-Language', async () => {
    const event = makeEvent({
      uri: '/studio/fr',
      cookie: undefined,
      acceptLanguage: 'en-US,en;q=0.9',
    });
    const result = await authModule.handler(event as any);
    if (result && 'status' in result) {
      expect(result.status).toBe('404');
      expect(result.body).toContain('This Studio page could not be found');
      expect(result.body).toContain('lang="en"');
    } else {
      throw new Error('Expected a 404 response');
    }
  });

  it('should allow supported language entrypoint rewrite', async () => {
    const event = makeEvent({ uri: '/studio/en', cookie: undefined });
    const result = await authModule.handler(event as any);
    if (result && 'uri' in result) {
      expect(result.uri).toBe('/en/index.html');
    } else {
      throw new Error('Expected request to be allowed');
    }
  });

  it('should not rewrite static assets', async () => {
    const event = makeEvent({ uri: '/studio/assets/logo.png', cookie: undefined });
    const result = await authModule.handler(event as any);
    if (result && 'uri' in result) {
      expect(result.uri).toBe('/assets/logo.png');
    } else {
      throw new Error('Expected request to be allowed');
    }
  });

  it('should exchange OAuth code and set auth cookie', async () => {
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';
    process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN = 'https://humblyproud.com/studio';

    const exchangeMock = jest.fn().mockResolvedValue({ id_token: 'jwt-from-cognito' } as any);
    authModule.setExchangeCodeForTokensImpl(exchangeMock);

    const event = makeEvent({ uri: '/studio', cookie: undefined }) as any;
    event.Records[0].cf.request.querystring = 'code=mock_code';

    const result = await authModule.handler(event);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toBe('https://humblyproud.com/studio');
      const setCookies = result.headers?.['set-cookie'] || [];
      const jwtCookie = setCookies[0]?.value || '';
      const authCookie = setCookies[1]?.value || '';
      expect(jwtCookie).toContain('jwt=jwt-from-cognito');
      expect(jwtCookie).toContain('HttpOnly');
      expect(jwtCookie).toContain('Secure');
      expect(jwtCookie).toContain('SameSite=Lax');
      expect(authCookie).toContain('auth=1');
      expect(authCookie).toContain('Secure');
      expect(authCookie).toContain('SameSite=Lax');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setExchangeCodeForTokensImpl(null);
  });

  it('should redirect to login when code exchange fails', async () => {
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';
    process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN = 'https://humblyproud.com/studio';

    const exchangeMock = jest.fn().mockResolvedValue(null);
    authModule.setExchangeCodeForTokensImpl(exchangeMock);

    const event = makeEvent({ uri: '/studio/app', cookie: undefined }) as any;
    event.Records[0].cf.request.querystring = 'code=bad_code';

    const result = await authModule.handler(event);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toContain('/studio/login');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setExchangeCodeForTokensImpl(null);
  });

  it('should redirect to login when code exchange fails on a non-/studio/app path', async () => {
    // Previously a failed exchange on any path other than /studio/app fell
    // through silently to public access, leaving the dead single-use code
    // in the URL with no way to retry cleanly.
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';
    process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN = 'https://humblyproud.com/studio';

    const exchangeMock = jest.fn().mockResolvedValue(null);
    authModule.setExchangeCodeForTokensImpl(exchangeMock);

    const event = makeEvent({ uri: '/studio', cookie: undefined }) as any;
    event.Records[0].cf.request.querystring = 'code=bad_code';

    const result = await authModule.handler(event);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toContain('/studio/login');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setExchangeCodeForTokensImpl(null);
  });

  it('should silently refresh an expired session and redirect back with new cookies', async () => {
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';

    authModule.setGetJwtPayloadImpl(async (cookie) =>
      cookie === 'jwt=fresh-token' ? { sub: 'user-123' } : null
    );
    const refreshMock = jest.fn().mockResolvedValue({ id_token: 'fresh-token' });
    authModule.setRefreshTokensImpl(refreshMock);

    const event = makeEvent({
      uri: '/studio/app',
      cookie: 'jwt=expired; refresh_token=refresh-abc',
    }) as any;

    const result = await authModule.handler(event);

    expect(refreshMock).toHaveBeenCalledWith({
      refreshToken: 'refresh-abc',
      clientId: 'client-id',
      domain: 'https://example.auth',
    });

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toBe('/studio/app');
      const setCookies = (result.headers?.['set-cookie'] || []).map((c) => c.value);
      expect(setCookies.some((c) => c.includes('jwt=fresh-token'))).toBe(true);
      expect(setCookies.some((c) => c.includes('refresh_token=refresh-abc'))).toBe(true);
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setGetJwtPayloadImpl(null);
    authModule.setRefreshTokensImpl(null);
  });

  it('should redirect to login when the refresh token is invalid or missing', async () => {
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';

    authModule.setGetJwtPayloadImpl(async () => null);
    const refreshMock = jest.fn().mockResolvedValue(null);
    authModule.setRefreshTokensImpl(refreshMock);

    const event = makeEvent({
      uri: '/studio/app',
      cookie: 'jwt=expired; refresh_token=stale-refresh',
    }) as any;

    const result = await authModule.handler(event);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toContain('/studio/login');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setGetJwtPayloadImpl(null);
    authModule.setRefreshTokensImpl(null);
  });

  it('should set refreshed cookies on a /studio/learning-state response', async () => {
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';

    authModule.setGetJwtPayloadImpl(async (cookie) =>
      cookie === 'jwt=fresh-token' ? { sub: 'user-123' } : null
    );
    authModule.setRefreshTokensImpl(async () => ({ id_token: 'fresh-token' }));
    authModule.setLearningStateStoreImpl({
      async get() {
        return { state: { currentArea: 'fdl' }, updatedAt: '2026-01-01T00:00:00.000Z' };
      },
      async put() {},
    });

    const event = makeEvent({
      uri: '/studio/learning-state',
      cookie: 'jwt=expired; refresh_token=refresh-abc',
      querystring: 'scope=global',
    });

    const result = await authModule.handler(event as any);

    if (result && 'status' in result) {
      expect(result.status).toBe('200');
      const setCookies = (result.headers?.['set-cookie'] || []).map((c) => c.value);
      expect(setCookies.some((c) => c.includes('jwt=fresh-token'))).toBe(true);
    } else {
      throw new Error('Expected a response');
    }

    authModule.setGetJwtPayloadImpl(null);
    authModule.setRefreshTokensImpl(null);
    authModule.setLearningStateStoreImpl(null);
  });

  it('should skip code exchange when env is missing', async () => {
    process.env.EDGE_AUTH_CONFIG_PATH = path.join(os.tmpdir(), 'edge-auth-config-missing.json');
    delete process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
    delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN;

    const exchangeMock = jest.fn().mockResolvedValue({ id_token: 'jwt-from-cognito' } as any);
    authModule.setExchangeCodeForTokensImpl(exchangeMock);

    const event = makeEvent({ uri: '/studio/app', cookie: undefined }) as any;
    event.Records[0].cf.request.querystring = 'code=mock_code';

    const result = await authModule.handler(event);

    expect(exchangeMock).not.toHaveBeenCalled();

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toContain('/studio/login');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setExchangeCodeForTokensImpl(null);
  });

  it('should redirect to cognito logout and clear cookie', async () => {
    process.env.EDGE_AUTH_CONFIG_PATH = path.join(os.tmpdir(), 'edge-auth-config-missing.json');
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://example.auth';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';
    process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT = 'https://humblyproud.com/studio';

    const event = makeEvent({ uri: '/studio/logout', cookie: 'jwt=valid' });
    const result = await authModule.handler(event as any);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toBe(
        'https://example.auth/logout?client_id=client-id&logout_uri=https%3A%2F%2Fhumblyproud.com%2Fstudio'
      );
      const setCookies = result.headers?.['set-cookie'] || [];
      const jwtCookie = setCookies[0]?.value || '';
      const authCookie = setCookies[1]?.value || '';
      expect(jwtCookie).toContain('jwt=');
      expect(jwtCookie).toContain('Expires=');
      expect(jwtCookie).toContain('HttpOnly');
      expect(jwtCookie).toContain('Secure');
      expect(authCookie).toContain('auth=');
      expect(authCookie).toContain('Expires=');
      expect(authCookie).toContain('Secure');
    } else {
      throw new Error('Expected a redirect response');
    }
  });

  it('should return user info for /studio/me when jwt is valid', async () => {
    const payload = { email: 'user@example.com', name: 'Test User', sub: 'abc123' };
    authModule.setGetJwtPayloadImpl(async () => payload);
    const event = makeEvent({ uri: '/studio/me', cookie: 'jwt=valid' });

    const result = await authModule.handler(event as any);

    if (result && 'status' in result) {
      expect(result.status).toBe('200');
      expect(result.headers?.['content-type']?.[0]?.value).toBe('application/json');
      expect(result.body).toContain('"email":"user@example.com"');
      expect(result.body).toContain('"name":"Test User"');
      expect(result.body).toContain('"sub":"abc123"');
    } else {
      throw new Error('Expected a response');
    }

    authModule.setGetJwtPayloadImpl(null);
  });

  it('should return 401 for /studio/me when jwt is missing or invalid', async () => {
    authModule.setGetJwtPayloadImpl(async () => null);
    const event = makeEvent({ uri: '/studio/me', cookie: undefined });

    const result = await authModule.handler(event as any);

    if (result && 'status' in result) {
      expect(result.status).toBe('401');
      expect(result.headers?.['content-type']?.[0]?.value).toBe('application/json');
    } else {
      throw new Error('Expected a response');
    }

    authModule.setGetJwtPayloadImpl(null);
  });

  it('should return 401 for /studio/learning-state when jwt is missing', async () => {
    authModule.setGetJwtPayloadImpl(async () => null);

    const event = makeEvent({ uri: '/studio/learning-state', cookie: undefined });
    const result = await authModule.handler(event as any);

    if (result && 'status' in result) {
      expect(result.status).toBe('401');
      expect(result.body).toContain('unauthorized');
    } else {
      throw new Error('Expected a response');
    }

    authModule.setGetJwtPayloadImpl(null);
  });

  it('should support PUT then GET for /studio/learning-state', async () => {
    const db = new Map<string, { state: any; updatedAt: string }>();
    authModule.setGetJwtPayloadImpl(async () => ({ sub: 'user-123' }));
    authModule.setLearningStateStoreImpl({
      async get(userId, scope) {
        return db.get(`${userId}:${scope}`) ?? null;
      },
      async put({ userId, scope, state, updatedAt }) {
        db.set(`${userId}:${scope}`, { state, updatedAt });
      },
    });

    const putEvent = makeEvent({
      uri: '/studio/learning-state',
      cookie: 'jwt=valid',
      method: 'PUT',
      querystring: 'scope=global',
      body: {
        data: JSON.stringify({
          state: {
            currentArea: 'fdl',
            areas: {
              fdl: {
                currentQuestion: 2,
              },
            },
          },
        }),
      },
    });

    const putResult = await authModule.handler(putEvent as any);
    if (putResult && 'status' in putResult) {
      expect(putResult.status).toBe('200');
    } else {
      throw new Error('Expected PUT response');
    }

    const getEvent = makeEvent({
      uri: '/studio/learning-state',
      cookie: 'jwt=valid',
      method: 'GET',
      querystring: 'scope=global',
    });

    const getResult = await authModule.handler(getEvent as any);
    if (getResult && 'status' in getResult) {
      expect(getResult.status).toBe('200');
      expect(getResult.body).toContain('"currentArea":"fdl"');
      expect(getResult.body).toContain('"currentQuestion":2');
    } else {
      throw new Error('Expected GET response');
    }

    authModule.setLearningStateStoreImpl(null);
    authModule.setGetJwtPayloadImpl(null);
  });

  it('should pass jwt email to learning-state store on PUT', async () => {
    const putSpy = jest.fn(async (params: any) => params);
    authModule.setGetJwtPayloadImpl(async () => ({
      sub: 'user-123',
      email: 'user@example.com',
    }));
    authModule.setLearningStateStoreImpl({
      async get() {
        return null;
      },
      put: putSpy as any,
    });

    const putEvent = makeEvent({
      uri: '/studio/learning-state',
      cookie: 'jwt=valid',
      method: 'PUT',
      querystring: 'scope=global',
      body: {
        data: JSON.stringify({
          state: {
            currentArea: 'log1',
            areas: {},
          },
        }),
      },
    });

    const putResult = await authModule.handler(putEvent as any);
    if (putResult && 'status' in putResult) {
      expect(putResult.status).toBe('200');
    } else {
      throw new Error('Expected PUT response');
    }

    expect(putSpy).toHaveBeenCalledTimes(1);
    const putArgs = putSpy.mock.calls.at(0)?.[0];
    if (!putArgs) {
      throw new Error('Expected put to be called with params');
    }
    expect(putArgs.userId).toBe('user-123');
    expect(putArgs.scope).toBe('global');
    expect(putArgs.userEmail).toBe('user@example.com');

    authModule.setLearningStateStoreImpl(null);
    authModule.setGetJwtPayloadImpl(null);
  });

  it('should read edge auth config from file when present', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-auth-'));
    const configPath = path.join(tempDir, 'edge-auth-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        domain: 'https://example.auth',
        clientId: 'client-id',
        redirectSignIn: 'https://humblyproud.com/studio',
      })
    );

    process.env.EDGE_AUTH_CONFIG_PATH = configPath;
    delete process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
    delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN;

    const exchangeMock = jest.fn().mockResolvedValue({ id_token: 'jwt-from-cognito' } as any);
    authModule.setExchangeCodeForTokensImpl(exchangeMock);

    const event = makeEvent({ uri: '/studio', cookie: undefined }) as any;
    event.Records[0].cf.request.querystring = 'code=mock_code';

    const result = await authModule.handler(event);

    if (result && 'status' in result) {
      expect(result.status).toBe('302');
      expect(result.headers?.location?.[0]?.value).toBe('https://humblyproud.com/studio');
      const setCookie = result.headers?.['set-cookie']?.[0]?.value || '';
      expect(setCookie).toContain('jwt=jwt-from-cognito');
    } else {
      throw new Error('Expected a redirect response');
    }

    authModule.setExchangeCodeForTokensImpl(null);
    delete process.env.EDGE_AUTH_CONFIG_PATH;
  });
});
