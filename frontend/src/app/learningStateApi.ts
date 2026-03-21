'use client';

import type { AppState } from './storage';
import { normalizeLanguage } from './i18n/config';
import {
  consumeDynamoDbCallAllowance,
  isRemoteLearningStateReadEnabled,
  isRemoteLearningStateWriteEnabled,
  logDynamoDbCall,
} from './persistenceMode';

interface LearningStateResponse {
  scope: string;
  state: AppState;
  updatedAt: string;
}

function getNormalizedBasePath(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  if (!basePath) return '';
  return basePath.startsWith('/') ? basePath.replace(/\/$/, '') : `/${basePath.replace(/\/$/, '')}`;
}

function getLearningStateEndpoint(scope: string): string {
  const basePath = getNormalizedBasePath();
  if (process.env.NODE_ENV === 'development') {
    return `${basePath}/api/learning-state?scope=${encodeURIComponent(scope)}`;
  }
  return `${basePath || '/studio'}/learning-state?scope=${encodeURIComponent(scope)}`;
}

function normalizeLearningState(input: unknown): AppState {
  let candidate: unknown = input;

  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { areas: {} };
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { areas: {} };
  }

  const obj = candidate as Partial<AppState>;
  return {
    language: typeof obj.language === 'string' ? normalizeLanguage(obj.language) : undefined,
    currentArea: typeof obj.currentArea === 'string' ? obj.currentArea : undefined,
    areas: obj.areas && typeof obj.areas === 'object' ? obj.areas : {},
    areaConfigByUser:
      obj.areaConfigByUser && typeof obj.areaConfigByUser === 'object'
        ? obj.areaConfigByUser
        : undefined,
  };
}

function buildAuthHeader(): HeadersInit {
  if (typeof window === 'undefined') {
    return {};
  }
  const jwt = window.localStorage.getItem('jwt');
  if (!jwt) {
    return {};
  }
  return {
    Authorization: `Bearer ${jwt}`,
  };
}

export async function getLearningState(scope = 'global'): Promise<LearningStateResponse | null> {
  if (!isRemoteLearningStateReadEnabled()) {
    return null;
  }
  if (!consumeDynamoDbCallAllowance('GET', scope)) {
    return null;
  }
  logDynamoDbCall('GET', scope, 'attempt');

  const response = await fetch(getLearningStateEndpoint(scope), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeader(),
  });

  if (response.status === 404) {
    logDynamoDbCall('GET', scope, 'error');
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    // During auth/bootstrap transitions, unauthorized responses are expected.
    // Returning null avoids noisy error logs while preserving local fallback behavior.
    logDynamoDbCall('GET', scope, 'error');
    return null;
  }
  if (!response.ok) {
    logDynamoDbCall('GET', scope, 'error');
    throw new Error(`Failed to fetch learning state: ${response.status}`);
  }

  const payload = (await response.json()) as {
    scope?: string;
    state?: unknown;
    updatedAt?: string;
  };

  const normalized = {
    scope: typeof payload.scope === 'string' ? payload.scope : scope,
    state: normalizeLearningState(payload.state),
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
  logDynamoDbCall('GET', scope, 'success');
  return normalized;
}

export async function getLearningStateForAuthBootstrap(
  scope = 'global'
): Promise<LearningStateResponse | null> {
  // Auth bootstrap must always attempt a read so login can hydrate local state,
  // even when optional read toggles are disabled.
  logDynamoDbCall('GET', scope, 'attempt');

  const requestOptions: RequestInit = {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildAuthHeader(),
  };

  let response = await fetch(getLearningStateEndpoint(scope), requestOptions);

  // Compatibility retry for deployments that still route the trailing-slash variant.
  if (response.status === 404 && process.env.NODE_ENV !== 'development') {
    const basePath = getNormalizedBasePath();
    response = await fetch(
      `${basePath || '/studio'}/learning-state/?scope=${encodeURIComponent(scope)}`,
      requestOptions
    );
  }

  if (response.status === 404) {
    logDynamoDbCall('GET', scope, 'error');
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    // During auth/bootstrap transitions, unauthorized responses are expected.
    // Returning null avoids noisy error logs while preserving local fallback behavior.
    logDynamoDbCall('GET', scope, 'error');
    return null;
  }
  if (!response.ok) {
    logDynamoDbCall('GET', scope, 'error');
    throw new Error(`Failed to fetch learning state: ${response.status}`);
  }

  const payload = (await response.json()) as {
    scope?: string;
    state?: unknown;
    updatedAt?: string;
  };

  const normalized = {
    scope: typeof payload.scope === 'string' ? payload.scope : scope,
    state: normalizeLearningState(payload.state),
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
  logDynamoDbCall('GET', scope, 'success');
  return normalized;
}

export async function putLearningState(
  state: AppState,
  scope = 'global',
  clientUpdatedAt?: string
): Promise<void> {
  if (!isRemoteLearningStateWriteEnabled()) {
    return;
  }
  if (!consumeDynamoDbCallAllowance('PUT', scope)) {
    return;
  }
  logDynamoDbCall('PUT', scope, 'attempt');

  const response = await fetch(getLearningStateEndpoint(scope), {
    method: 'PUT',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeader(),
    },
    body: JSON.stringify({
      state,
      clientUpdatedAt,
    }),
  });

  if (!response.ok) {
    logDynamoDbCall('PUT', scope, 'error');
    throw new Error(`Failed to persist learning state: ${response.status}`);
  }
  logDynamoDbCall('PUT', scope, 'success');
}
