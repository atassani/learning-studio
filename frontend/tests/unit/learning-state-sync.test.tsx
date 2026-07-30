import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useLearningStateSync } from '../../src/app/hooks/useLearningStateSync';
import { LEARNING_STUDIO_STATE_CHANGED_EVENT } from '../../src/app/storage';
import { getLearningStateForAuthBootstrap, putLearningState } from '../../src/app/learningStateApi';

jest.mock('../../src/app/learningStateApi', () => ({
  getLearningStateForAuthBootstrap: jest.fn(),
  putLearningState: jest.fn(),
}));

function HookHarness({ enabled }: { enabled: boolean }) {
  useLearningStateSync({ enabled });
  return null;
}

describe('useLearningStateSync', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('persists updated language remotely after bootstrap completes', async () => {
    (getLearningStateForAuthBootstrap as jest.Mock).mockResolvedValue(null);
    (putLearningState as jest.Mock).mockResolvedValue(undefined);

    render(<HookHarness enabled />);

    await waitFor(() => {
      expect(getLearningStateForAuthBootstrap).toHaveBeenCalledWith('global');
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(LEARNING_STUDIO_STATE_CHANGED_EVENT, {
          detail: {
            areas: {},
            language: 'en',
          },
        })
      );
    });

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(putLearningState).toHaveBeenCalledTimes(1);
    });

    expect(putLearningState).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en' }),
      'global',
      expect.any(String)
    );
  });

  it('writes a sanitized remote snapshot back once after bootstrap', async () => {
    (getLearningStateForAuthBootstrap as jest.Mock).mockResolvedValue({
      scope: 'global',
      updatedAt: '2026-07-30T10:00:00.000Z',
      state: {
        language: 'en',
        currentArea: 'log1',
        areas: {
          log1: {
            currentQuestion: 0,
            quizStatus: {},
            selectedQuestions: [],
            shuffleQuestions: false,
          },
          log2: {
            currentQuestion: 1,
            quizStatus: { 0: 'correct', 1: 'pending' },
            selectedQuestions: [0, 1],
          },
        },
      },
    });
    (putLearningState as jest.Mock).mockResolvedValue(undefined);

    render(<HookHarness enabled />);

    await waitFor(() => {
      expect(putLearningState).toHaveBeenCalledTimes(1);
    });

    expect(putLearningState).toHaveBeenCalledWith(
      {
        language: 'en',
        currentArea: 'log1',
        areas: {
          log1: {
            shuffleQuestions: false,
          },
          log2: {
            currentQuestion: 1,
            quizStatus: { 0: 'correct', 1: 'pending' },
            selectedQuestions: [0, 1],
          },
        },
      },
      'global',
      expect.any(String)
    );
  });
});
