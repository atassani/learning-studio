// Lambda@Edge authentication handler for /studio/*
// Supports: OAuth redirect, JWT/cookie validation, guest access

import { CloudFrontRequestEvent, CloudFrontRequestResult, CloudFrontRequest } from 'aws-lambda';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

type LearningStateValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface LearningStateStore {
  get(
    userId: string,
    scope: string
  ): Promise<{ state: LearningStateValue; updatedAt: string } | null>;
  put(params: {
    userId: string;
    scope: string;
    state: LearningStateValue;
    updatedAt: string;
    clientUpdatedAt?: string;
    userEmail?: string;
  }): Promise<void>;
}

// Minimal Cognito JWT validation
function getCognitoConfig() {
  const fileConfig = readEdgeAuthConfig();
  const region = fileConfig?.region ?? process.env.NEXT_PUBLIC_AWS_REGION;
  const userPoolId = fileConfig?.userPoolId ?? process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const domain = fileConfig?.domain ?? process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = fileConfig?.clientId ?? process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const redirectSignIn = fileConfig?.redirectSignIn ?? process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN;
  const redirectSignOut = fileConfig?.redirectSignOut ?? process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT;
  const learningStateTable =
    fileConfig?.learningStateTable ?? process.env.STUDIO_LEARNING_STATE_TABLE;
  const learningStateRegion =
    fileConfig?.learningStateRegion ?? process.env.STUDIO_LEARNING_STATE_REGION ?? region;
  const userIdentityAdminTable =
    fileConfig?.userIdentityAdminTable ?? process.env.STUDIO_USER_IDENTITY_ADMIN_TABLE;
  const userIdentityAdminRegion =
    fileConfig?.userIdentityAdminRegion ??
    process.env.STUDIO_USER_IDENTITY_ADMIN_REGION ??
    learningStateRegion;
  const issuer =
    region && userPoolId ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` : undefined;
  const jwksUrl = issuer ? `${issuer}/.well-known/jwks.json` : undefined;

  return {
    region,
    userPoolId,
    domain,
    clientId,
    redirectSignIn,
    redirectSignOut,
    learningStateTable,
    learningStateRegion,
    userIdentityAdminTable,
    userIdentityAdminRegion,
    issuer,
    jwksUrl,
  };
}

function readEdgeAuthConfig(): {
  region?: string;
  userPoolId?: string;
  domain?: string;
  clientId?: string;
  redirectSignIn?: string;
  redirectSignOut?: string;
  learningStateTable?: string;
  learningStateRegion?: string;
  userIdentityAdminTable?: string;
  userIdentityAdminRegion?: string;
} | null {
  const configPath =
    process.env.EDGE_AUTH_CONFIG_PATH ?? path.join(__dirname, 'edge-auth-config.json');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

// Origin-request Lambda@Edge gets a 30s execution budget, but these calls
// still need an explicit cap - an unbounded network call can hang and burn
// the whole budget, turning a slow Cognito response into a hard failure
// instead of a fast, retryable one.
const TOKEN_REQUEST_TIMEOUT_MS = 8000;

export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  domain: string;
}): Promise<TokenResponse | null> {
  const tokenUrl = new URL('/oauth2/token', params.domain);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
  }).toString();

  const responseBody = await postForm(tokenUrl, body);
  if (responseBody === null) return null;
  try {
    return JSON.parse(responseBody);
  } catch (err) {
    return null;
  }
}

let exchangeCodeForTokensImpl = exchangeCodeForTokens;

export function setExchangeCodeForTokensImpl(impl: typeof exchangeCodeForTokens | null): void {
  exchangeCodeForTokensImpl = impl ?? exchangeCodeForTokens;
}

export async function refreshTokens(params: {
  refreshToken: string;
  clientId: string;
  domain: string;
}): Promise<TokenResponse | null> {
  const tokenUrl = new URL('/oauth2/token', params.domain);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  }).toString();

  const responseBody = await postForm(tokenUrl, body);
  if (responseBody === null) return null;
  try {
    return JSON.parse(responseBody);
  } catch (err) {
    return null;
  }
}

let refreshTokensImpl = refreshTokens;

export function setRefreshTokensImpl(impl: typeof refreshTokens | null): void {
  refreshTokensImpl = impl ?? refreshTokens;
}

// Resolves to the response body on success, or null on network error/timeout
// so callers can treat "couldn't reach Cognito" the same as "Cognito said no"
// rather than letting an unhandled rejection propagate.
function postForm(url: URL, body: string): Promise<string | null> {
  return new Promise((resolve) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }
    );

    request.setTimeout(TOKEN_REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
    request.write(body);
    request.end();
  });
}

function extractCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : undefined;
}

// Cached at module scope so a warm Lambda@Edge container reuses the fetched
// JWKS across invocations instead of hitting Cognito's JWKS endpoint on
// every single authenticated request. jose's returned JWKS set caches keys
// internally once fetched, but only if the same instance is reused.
let cachedJwks: { url: string; jwks: unknown } | null = null;

function getJwks(jwksUrl: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRemoteJWKSet } = require('jose');
  if (!cachedJwks || cachedJwks.url !== jwksUrl) {
    cachedJwks = {
      url: jwksUrl,
      jwks: createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: TOKEN_REQUEST_TIMEOUT_MS }),
    };
  }
  return cachedJwks.jwks;
}

export async function getJwtPayload(
  cookie: string | undefined
): Promise<Record<string, any> | null> {
  if (!cookie) return null;
  const { issuer, jwksUrl } = getCognitoConfig();
  if (!issuer || !jwksUrl) return null;
  // Import jose only when needed (avoids ESM parse errors in Jest)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { jwtVerify } = require('jose');
  const jwks = getJwks(jwksUrl);
  const token = extractCookieValue(cookie, 'jwt');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      // Accept tokens from Google federated users (sub claim is a Google subject)
      // Optionally check audience: e.g. audience: 'your-client-id',
    });
    return payload;
  } catch (err) {
    return null;
  }
}

export async function isValidJWT(cookie: string | undefined): Promise<boolean> {
  const payload = await getJwtPayload(cookie);
  return Boolean(payload);
}

let getJwtPayloadImpl = getJwtPayload;

export function setGetJwtPayloadImpl(impl: typeof getJwtPayload | null): void {
  getJwtPayloadImpl = impl ?? getJwtPayload;
}

// Cognito refresh tokens default to 30 days of validity on the App Client;
// keep this in sync with that setting if it's ever changed in Cognito.
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function buildAuthCookies(tokens: { id_token: string; refresh_token?: string }): {
  key: string;
  value: string;
}[] {
  const cookies = [
    { key: 'Set-Cookie', value: ['jwt=' + tokens.id_token, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'].join('; ') },
    { key: 'Set-Cookie', value: ['auth=1', 'Path=/', 'Secure', 'SameSite=Lax'].join('; ') },
  ];
  if (tokens.refresh_token) {
    cookies.push({
      key: 'Set-Cookie',
      value: [
        'refresh_token=' + tokens.refresh_token,
        'Path=/',
        'Max-Age=' + REFRESH_TOKEN_MAX_AGE_SECONDS,
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
      ].join('; '),
    });
  }
  return cookies;
}

interface AuthResolution {
  payload: Record<string, any> | null;
  refreshSetCookies?: { key: string; value: string }[];
}

// Tries the id token first; if it's missing/expired, attempts one silent
// refresh via the refresh_token cookie before giving up. Without this, a
// session silently dies whenever the short-lived id token expires (~1h by
// default) even though the user never logged out.
async function resolveAuthenticatedPayload(
  cookieHeader: string | undefined,
  cognitoConfig: { domain?: string; clientId?: string }
): Promise<AuthResolution> {
  const payload = await getJwtPayloadImpl(cookieHeader);
  if (payload) {
    return { payload };
  }

  const refreshToken = extractCookieValue(cookieHeader, 'refresh_token');
  if (!refreshToken || !cognitoConfig.domain || !cognitoConfig.clientId) {
    return { payload: null };
  }

  const refreshed = await refreshTokensImpl({
    refreshToken,
    clientId: cognitoConfig.clientId,
    domain: cognitoConfig.domain,
  });
  if (!refreshed?.id_token) {
    return { payload: null };
  }

  const refreshedPayload = await getJwtPayloadImpl(`jwt=${refreshed.id_token}`);
  if (!refreshedPayload) {
    return { payload: null };
  }

  // Cognito doesn't rotate refresh tokens on a refresh grant by default, so
  // keep the existing one unless a new one was returned.
  return {
    payload: refreshedPayload,
    refreshSetCookies: buildAuthCookies({
      id_token: refreshed.id_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
    }),
  };
}

let learningStateStoreImpl: LearningStateStore | null | undefined;

export function setLearningStateStoreImpl(impl: LearningStateStore | null): void {
  learningStateStoreImpl = impl;
}

function getLearningStateStore(): LearningStateStore | null {
  if (learningStateStoreImpl !== undefined) {
    return learningStateStoreImpl;
  }
  learningStateStoreImpl = createDynamoLearningStateStore();
  return learningStateStoreImpl;
}

function createDynamoLearningStateStore(): LearningStateStore | null {
  const {
    learningStateTable,
    learningStateRegion,
    userIdentityAdminTable,
    userIdentityAdminRegion,
  } = getCognitoConfig();
  if (!learningStateTable || !learningStateRegion) {
    return null;
  }

  // First try AWS SDK v3 (available in modern Lambda runtimes).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient({ region: learningStateRegion });
    const adminClient =
      userIdentityAdminTable && userIdentityAdminRegion
        ? new DynamoDBClient({ region: userIdentityAdminRegion })
        : null;
    return {
      async get(userId: string, scope: string) {
        const out = await client.send(
          new GetItemCommand({
            TableName: learningStateTable,
            Key: {
              pk: { S: `USER#${userId}` },
              sk: { S: `SCOPE#${scope}` },
            },
          })
        );

        const item = out.Item;
        if (!item || !item.state?.S) {
          return null;
        }
        const updatedAt = item.updatedAt?.S ?? '';
        return { state: JSON.parse(item.state.S), updatedAt };
      },
      async put({ userId, scope, state, updatedAt, clientUpdatedAt, userEmail }) {
        await client.send(
          new PutItemCommand({
            TableName: learningStateTable,
            Item: {
              pk: { S: `USER#${userId}` },
              sk: { S: `SCOPE#${scope}` },
              state: { S: JSON.stringify(state) },
              updatedAt: { S: updatedAt },
              ...(clientUpdatedAt ? { clientUpdatedAt: { S: clientUpdatedAt } } : {}),
            },
          })
        );

        // Best-effort admin mapping for support/debug use cases.
        if (adminClient && userIdentityAdminTable) {
          if (typeof userEmail === 'string' && userEmail.length > 0) {
            try {
              await adminClient.send(
                new PutItemCommand({
                  TableName: userIdentityAdminTable,
                  Item: {
                    userId: { S: userId },
                    lastKnownEmail: { S: userEmail },
                    updatedAt: { S: updatedAt },
                  },
                })
              );
            } catch {
              // Ignore admin mapping failures to avoid blocking primary learning-state writes.
            }
          }
        }
      },
    };
  } catch (error) {
    // Try AWS SDK v2 as fallback.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AWS = require('aws-sdk');
    const docClient = new AWS.DynamoDB.DocumentClient({ region: learningStateRegion });
    const adminDocClient =
      userIdentityAdminTable && userIdentityAdminRegion
        ? new AWS.DynamoDB.DocumentClient({ region: userIdentityAdminRegion })
        : null;

    return {
      async get(userId: string, scope: string) {
        const out = await docClient
          .get({
            TableName: learningStateTable,
            Key: {
              pk: `USER#${userId}`,
              sk: `SCOPE#${scope}`,
            },
          })
          .promise();
        if (!out.Item) {
          return null;
        }
        return {
          state: out.Item.state as LearningStateValue,
          updatedAt: (out.Item.updatedAt as string) ?? '',
        };
      },
      async put({ userId, scope, state, updatedAt, clientUpdatedAt, userEmail }) {
        await docClient
          .put({
            TableName: learningStateTable,
            Item: {
              pk: `USER#${userId}`,
              sk: `SCOPE#${scope}`,
              state,
              updatedAt,
              ...(clientUpdatedAt ? { clientUpdatedAt } : {}),
            },
          })
          .promise();

        if (adminDocClient && userIdentityAdminTable) {
          if (typeof userEmail === 'string' && userEmail.length > 0) {
            try {
              await adminDocClient
                .put({
                  TableName: userIdentityAdminTable,
                  Item: {
                    userId,
                    lastKnownEmail: userEmail,
                    updatedAt,
                  },
                })
                .promise();
            } catch {
              // Ignore admin mapping failures to avoid blocking primary learning-state writes.
            }
          }
        }
      },
    };
  } catch (error) {
    return null;
  }
}

const LOGIN_URL = '/studio/login';
const SUPPORTED_ROUTE_LANGUAGES = new Set(['es', 'en', 'ca']);
const SUPPORTED_UI_LANGUAGES = new Set(['es', 'en', 'ca']);

function isStaticAsset(uri: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(uri);
}

function getStudioFirstSegment(uri: string): string | null {
  if (!uri.startsWith('/studio/')) return null;
  const withoutPrefix = uri.slice('/studio/'.length);
  if (!withoutPrefix) return null;
  const firstSegment = withoutPrefix.split('/')[0];
  return firstSegment || null;
}

function isUnsupportedLanguageEntrypoint(uri: string): boolean {
  const firstSegment = getStudioFirstSegment(uri);
  if (!firstSegment) return false;
  if (!/^[a-z]{2}$/i.test(firstSegment)) return false;
  return !SUPPORTED_ROUTE_LANGUAGES.has(firstSegment.toLowerCase());
}

function resolveUiLanguageFromRequest(request: CloudFrontRequest): 'es' | 'en' | 'ca' {
  const acceptLanguage = request.headers['accept-language']?.[0]?.value?.toLowerCase() ?? '';
  if (acceptLanguage.includes('ca')) return 'ca';
  if (acceptLanguage.includes('en')) return 'en';
  if (acceptLanguage.includes('es')) return 'es';

  const firstSegment = getStudioFirstSegment(request.uri)?.toLowerCase();
  if (firstSegment && SUPPORTED_UI_LANGUAGES.has(firstSegment)) {
    return firstSegment as 'es' | 'en' | 'ca';
  }
  return 'es';
}

function studioNotFoundResponse(request: CloudFrontRequest): CloudFrontRequestResult {
  const lang = resolveUiLanguageFromRequest(request);
  const copyByLanguage: Record<'es' | 'en' | 'ca', { title: string; body: string }> = {
    es: {
      title: 'Esta página de Studio no existe.',
      body: 'Revisa la URL o vuelve a /studio.',
    },
    en: {
      title: 'This Studio page could not be found.',
      body: 'Check the URL or go back to /studio.',
    },
    ca: {
      title: "Aquesta pàgina d'Studio no existeix.",
      body: "Revisa l'URL o torna a /studio.",
    },
  };
  const copy = copyByLanguage[lang];
  return {
    status: '404',
    statusDescription: 'Not Found',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Studio 404</title></head><body><h1>404</h1><p>${copy.title}</p><p>${copy.body}</p></body></html>`,
  };
}

function maybeRewriteSpaPath(request: CloudFrontRequest): void {
  const uri = request.uri;
  if (!uri.startsWith('/studio')) return;

  // Strip /studio prefix so the S3 bucket uses root paths
  let stripped = uri.slice('/studio'.length);
  if (!stripped || stripped === '/') {
    request.uri = '/index.html';
    return;
  }

  if (isStaticAsset(stripped)) {
    request.uri = stripped;
    return;
  }

  // SPA fallback: non-asset paths get /index.html
  request.uri = stripped + '/index.html';
}

function jsonResponse(
  status: string,
  body: unknown,
  setCookies?: { key: string; value: string }[]
): CloudFrontRequestResult {
  return {
    status,
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
      ...(setCookies ? { 'set-cookie': setCookies } : {}),
    },
    body: JSON.stringify(body),
  };
}

function parseRequestJsonBody(request: CloudFrontRequest): Record<string, unknown> | null {
  const reqBody = (request as any).body;
  if (!reqBody || typeof reqBody.data !== 'string') {
    return null;
  }

  try {
    const raw =
      reqBody.encoding === 'base64'
        ? Buffer.from(reqBody.data, 'base64').toString('utf8')
        : reqBody.data;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getCandidateUserIdsFromPayload(payload: Record<string, any>): string[] {
  const sub = normalizeCandidate(payload.sub);
  const email = normalizeCandidate(payload.email);
  const preferredUsername = normalizeCandidate(payload.preferred_username);
  const cognitoUsername = normalizeCandidate(payload['cognito:username']);
  const legacyGoogleEmail = email ? normalizeCandidate(`Google_${email}`) : null;

  const candidates = [sub, email, preferredUsername, cognitoUsername, legacyGoogleEmail].filter(
    (value): value is string => Boolean(value)
  );
  return Array.from(new Set(candidates));
}

function getCandidateScopes(scope: string): string[] {
  if (scope === 'global') {
    return ['global', 'default'];
  }
  return [scope];
}

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  const request: CloudFrontRequest = event.Records[0].cf.request;
  const uri = request.uri;
  const method = request.method ?? 'GET';
  const cookieHeader = request.headers.cookie?.[0]?.value;
  const querystring = request.querystring || '';
  const queryParams = new URLSearchParams(querystring);
  const code = queryParams.get('code');
  const { domain, clientId, redirectSignIn, redirectSignOut } = getCognitoConfig();

  if (uri.startsWith('/studio/me')) {
    const { payload, refreshSetCookies } = await resolveAuthenticatedPayload(cookieHeader, {
      domain,
      clientId,
    });
    if (!payload) {
      return {
        status: '401',
        statusDescription: 'Unauthorized',
        headers: {
          'content-type': [{ key: 'Content-Type', value: 'application/json' }],
          'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
        },
        body: JSON.stringify({ error: 'unauthorized' }),
      };
    }

    const user = {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      given_name: payload.given_name,
      family_name: payload.family_name,
      preferred_username: payload.preferred_username,
    };

    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'application/json' }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
        ...(refreshSetCookies ? { 'set-cookie': refreshSetCookies } : {}),
      },
      body: JSON.stringify(user),
    };
  }

  if (uri.startsWith('/studio/learning-state')) {
    const { payload, refreshSetCookies } = await resolveAuthenticatedPayload(cookieHeader, {
      domain,
      clientId,
    });
    if (!payload?.sub) {
      return jsonResponse('401', { error: 'unauthorized' });
    }

    const store = getLearningStateStore();
    if (!store) {
      return jsonResponse('503', { error: 'learning_state_store_unavailable' });
    }

    const scope = queryParams.get('scope') ?? 'global';
    if (method === 'GET') {
      try {
        const candidateUserIds = getCandidateUserIdsFromPayload(payload as Record<string, any>);
        const candidateScopes = getCandidateScopes(scope);

        let state: {
          state: LearningStateValue;
          updatedAt: string;
          userId: string;
          scope: string;
        } | null = null;

        for (const candidateUserId of candidateUserIds) {
          for (const candidateScope of candidateScopes) {
            const found = await store.get(candidateUserId, candidateScope);
            if (found) {
              state = {
                ...found,
                userId: candidateUserId,
                scope: candidateScope,
              };
              break;
            }
          }
          if (state) break;
        }

        if (!state) {
          return jsonResponse('404', { error: 'not_found' });
        }

        // Best-effort migration to canonical sub/global key.
        if (state.userId !== String(payload.sub) || state.scope !== scope) {
          try {
            await store.put({
              userId: String(payload.sub),
              scope,
              state: state.state,
              updatedAt: new Date().toISOString(),
              userEmail: typeof payload.email === 'string' ? payload.email : undefined,
            });
          } catch {
            // Ignore migration failures; read succeeded.
          }
        }

        return jsonResponse(
          '200',
          {
            scope,
            state: state.state,
            updatedAt: state.updatedAt,
          },
          refreshSetCookies
        );
      } catch {
        return jsonResponse('500', { error: 'learning_state_read_failed' });
      }
    }

    if (method === 'PUT') {
      const body = parseRequestJsonBody(request);
      if (!body || !('state' in body)) {
        return jsonResponse('400', { error: 'invalid_payload' });
      }

      try {
        const updatedAt = new Date().toISOString();
        await store.put({
          userId: String(payload.sub),
          scope,
          state: body.state as LearningStateValue,
          updatedAt,
          clientUpdatedAt:
            typeof body.clientUpdatedAt === 'string' ? body.clientUpdatedAt : undefined,
          userEmail: typeof payload.email === 'string' ? payload.email : undefined,
        });
        return jsonResponse('200', { scope, updatedAt }, refreshSetCookies);
      } catch {
        return jsonResponse('500', { error: 'learning_state_write_failed' });
      }
    }

    return jsonResponse('405', { error: 'method_not_allowed' });
  }

  if (uri.startsWith('/studio/logout')) {
    const logoutCookie = [
      'jwt=',
      'Path=/',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ].join('; ');
    const logoutAuthCookie = [
      'auth=',
      'Path=/',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Secure',
      'SameSite=Lax',
    ].join('; ');

    const fallbackLocation = LOGIN_URL;
    const logoutUrl =
      domain && clientId && redirectSignOut
        ? `${domain}/logout?client_id=${encodeURIComponent(
            clientId
          )}&logout_uri=${encodeURIComponent(redirectSignOut)}`
        : fallbackLocation;

    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{ key: 'Location', value: logoutUrl }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
        'set-cookie': [
          { key: 'Set-Cookie', value: logoutCookie },
          { key: 'Set-Cookie', value: logoutAuthCookie },
        ],
      },
      body: '',
    };
  }

  // Allow guest access for /studio/guest
  if (uri.startsWith('/studio/guest')) {
    maybeRewriteSpaPath(request);
    return request;
  }

  if (isUnsupportedLanguageEntrypoint(uri)) {
    return studioNotFoundResponse(request);
  }

  // Handle OAuth callback code exchange for Cognito Hosted UI
  if (code && domain && clientId && redirectSignIn) {
    const tokens = await exchangeCodeForTokensImpl({
      code,
      redirectUri: redirectSignIn,
      clientId,
      domain,
    });

    if (tokens?.id_token) {
      return {
        status: '302',
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: redirectSignIn }],
          'cache-control': [{ key: 'Cache-Control', value: 'no-cache' }],
          'set-cookie': buildAuthCookies({
            id_token: tokens.id_token,
            refresh_token: tokens.refresh_token,
          }),
        },
        body: '',
      };
    }

    // The authorization code is single-use and has now been consumed by the
    // failed exchange attempt above (network timeout, Cognito error, etc.).
    // Redirect to a clean login URL rather than falling through silently -
    // otherwise a page refresh would resend the same dead code and fail
    // again with no visible feedback.
    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{ key: 'Location', value: LOGIN_URL }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      body: '',
    };
  }

  // Allow if valid JWT/cookie, refreshing a silently-expired session once
  // before giving up.
  const { payload: mainPayload, refreshSetCookies: mainRefreshSetCookies } =
    await resolveAuthenticatedPayload(cookieHeader, { domain, clientId });
  if (mainPayload) {
    if (mainRefreshSetCookies) {
      // This behavior only allows GET/HEAD, so redirecting to the same URL
      // is safe. A pass-through `request` result can't carry Set-Cookie
      // headers back to the viewer, so the refreshed session is delivered
      // via one redirect and picked up on the follow-up request.
      return {
        status: '302',
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: uri + (querystring ? `?${querystring}` : '') }],
          'cache-control': [{ key: 'Cache-Control', value: 'no-cache' }],
          'set-cookie': mainRefreshSetCookies,
        },
        body: '',
      };
    }
    maybeRewriteSpaPath(request);
    return request;
  }

  // Redirect unauthenticated access to /studio/app to /studio/login (no query params)
  if (uri.startsWith('/studio/app')) {
    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{ key: 'Location', value: LOGIN_URL }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      body: '',
    };
  }

  // Allow public access to other /studio paths
  maybeRewriteSpaPath(request);
  return request;
}
