'use client';

import { useEffect, useRef } from 'react';
import {
  AppState,
  LEARNING_STUDIO_STATE_CHANGED_EVENT,
  sanitizeAppState,
  storage,
} from '../storage';
import { getLearningStateForAuthBootstrap, putLearningState } from '../learningStateApi';

interface UseLearningStateSyncOptions {
  enabled: boolean;
  onServerStateApplied?: () => void;
  onBootstrapCompleted?: () => void;
}

export function useLearningStateSync({
  enabled,
  onServerStateApplied,
  onBootstrapCompleted,
}: UseLearningStateSyncOptions) {
  const initializedRef = useRef(false);
  const bootstrapRequestRef = useRef<ReturnType<typeof getLearningStateForAuthBootstrap> | null>(
    null
  );
  const suppressNextSyncRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onServerStateAppliedRef = useRef(onServerStateApplied);
  const onBootstrapCompletedRef = useRef(onBootstrapCompleted);

  useEffect(() => {
    onServerStateAppliedRef.current = onServerStateApplied;
  }, [onServerStateApplied]);

  useEffect(() => {
    onBootstrapCompletedRef.current = onBootstrapCompleted;
  }, [onBootstrapCompleted]);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      initializedRef.current = false;
      bootstrapRequestRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const bootstrap = async () => {
      try {
        const localState = storage.getStateSnapshot();
        if (!bootstrapRequestRef.current) {
          bootstrapRequestRef.current = getLearningStateForAuthBootstrap('global');
        }
        const remote = await bootstrapRequestRef.current;
        if (cancelled) {
          return;
        }

        if (remote?.state) {
          const sanitizedRemoteState = sanitizeAppState(remote.state);
          const remoteStateChanged =
            JSON.stringify(sanitizedRemoteState) !== JSON.stringify(remote.state);
          suppressNextSyncRef.current = true;
          storage.replaceState(sanitizedRemoteState);
          onServerStateAppliedRef.current?.();
          if (remoteStateChanged) {
            await putLearningState(sanitizedRemoteState, 'global', new Date().toISOString());
          }
        } else if (hasLocalProgress(localState)) {
          await putLearningState(localState, 'global', new Date().toISOString());
        }
      } catch (error) {
        console.error('Failed to bootstrap learning state sync', error);
      } finally {
        if (!cancelled) {
          initializedRef.current = true;
          onBootstrapCompletedRef.current?.();
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const queueSave = (state: AppState) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(async () => {
        if (!initializedRef.current) {
          return;
        }
        try {
          await putLearningState(state, 'global', new Date().toISOString());
        } catch (error) {
          console.error('Failed to sync learning state', error);
        }
      }, 800);
    };

    const onStateChanged = (event: Event) => {
      if (suppressNextSyncRef.current) {
        suppressNextSyncRef.current = false;
        return;
      }
      const customEvent = event as CustomEvent<AppState>;
      const state = customEvent.detail ?? storage.getStateSnapshot();
      queueSave(state);
    };

    window.addEventListener(LEARNING_STUDIO_STATE_CHANGED_EVENT, onStateChanged);

    return () => {
      window.removeEventListener(LEARNING_STUDIO_STATE_CHANGED_EVENT, onStateChanged);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [enabled]);
}

function hasLocalProgress(state: AppState): boolean {
  if (state.currentArea) {
    return true;
  }
  return Object.keys(state.areas ?? {}).length > 0;
}
