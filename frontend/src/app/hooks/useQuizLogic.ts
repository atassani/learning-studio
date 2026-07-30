'use client';
import { useCallback } from 'react';
import { QuestionType, AreaType } from '../types';
import { storage } from '../storage';

interface UseQuizLogicProps {
  allQuestions: QuestionType[];
  selectedSections: Set<string>;
  selectedQuestions: Set<number>;
  selectedArea: AreaType | null;
  shuffleQuestions: boolean;
  setQuestions: (questions: QuestionType[]) => void;
  setStatus: (status: Record<number, 'correct' | 'fail' | 'pending'>) => void;
  setCurrent: (current: number | null) => void;
  setShowStatus: (show: boolean) => void;
  setShowResult: (result: null | { correct: boolean; explanation: string }) => void;
  setShowSelectionMenu: (show: boolean) => void;
  setSelectionMode: (mode: null | 'all' | 'sections' | 'questions') => void;
  setSelectedSections: (sections: Set<string>) => void;
  setSelectedQuestions: (questions: Set<number>) => void;
}

export function useQuizLogic({
  allQuestions,
  selectedSections,
  selectedQuestions,
  selectedArea,
  shuffleQuestions,
  setQuestions,
  setStatus,
  setCurrent,
  setShowStatus,
  setShowResult,
  setShowSelectionMenu,
  setSelectionMode,
  setSelectedSections,
  setSelectedQuestions,
}: UseQuizLogicProps) {
  // Start quiz with all questions
  const startQuizAll = useCallback(() => {
    if (!selectedArea || allQuestions.length === 0) return;

    const areaKey = selectedArea.shortName;
    const orderedQuestions = [...allQuestions];

    // Apply ordering based on shuffleQuestions setting
    if (shuffleQuestions) {
      // Use time-based randomization for better variation
      const seed = Date.now() + Math.random();
      let random = Math.sin(seed) * 10000;
      random = random - Math.floor(random);

      // Fisher-Yates shuffle with time-based seeding
      for (let i = orderedQuestions.length - 1; i > 0; i--) {
        // Generate next pseudo-random number in sequence
        random = (random * 9301 + 49297) % 233280;
        const j = Math.floor((random / 233280) * (i + 1));
        [orderedQuestions[i], orderedQuestions[j]] = [orderedQuestions[j], orderedQuestions[i]];
      }
    } else {
      // Sequential: sort by question number
      orderedQuestions.sort((a, b) => a.number - b.number);
    }

    setQuestions(orderedQuestions);

    // Load or initialize status
    const savedStatus = storage.getAreaQuizStatus(areaKey);
    let newStatus: Record<number, 'correct' | 'fail' | 'pending'>;
    if (savedStatus) {
      const parsedStatus = savedStatus;
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = parsedStatus[q.index] || 'pending';
          return acc;
        },
        {}
      );
    } else {
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = 'pending';
          return acc;
        },
        {}
      );
    }
    setStatus(newStatus);
    storage.setAreaQuizStatus(areaKey, newStatus);

    // Store selected questions for session restoration
    storage.setAreaSelectedQuestions(
      areaKey,
      orderedQuestions.map((q) => q.index)
    );

    // Always start at the beginning when starting all questions
    if (orderedQuestions.length > 0) {
      setCurrent(0);
      setShowStatus(false);
    } else {
      setCurrent(null);
      setShowStatus(true);
    }
    setShowResult(null);
    setShowSelectionMenu(false);
    setSelectionMode(null);
  }, [
    allQuestions,
    selectedArea,
    shuffleQuestions,
    setQuestions,
    setStatus,
    setCurrent,
    setShowStatus,
    setShowResult,
    setShowSelectionMenu,
    setSelectionMode,
  ]);

  // Start quiz with selected sections
  const startQuizSections = useCallback(() => {
    if (!selectedArea) return;

    const areaKey = selectedArea.shortName;
    const filtered = allQuestions.filter((q) => selectedSections.has(q.section));
    if (filtered.length === 0) return;

    const orderedQuestions = [...filtered];

    // Apply ordering based on shuffleQuestions setting
    if (shuffleQuestions) {
      // Use time-based randomization for better variation
      const seed = Date.now() + Math.random();
      let random = Math.sin(seed) * 10000;
      random = random - Math.floor(random);

      // Fisher-Yates shuffle with time-based seeding
      for (let i = orderedQuestions.length - 1; i > 0; i--) {
        // Generate next pseudo-random number in sequence
        random = (random * 9301 + 49297) % 233280;
        const j = Math.floor((random / 233280) * (i + 1));
        [orderedQuestions[i], orderedQuestions[j]] = [orderedQuestions[j], orderedQuestions[i]];
      }
    } else {
      // Sequential: sort by question number
      orderedQuestions.sort((a, b) => a.number - b.number);
    }

    setQuestions(orderedQuestions);

    // Load or initialize status
    const savedStatus = storage.getAreaQuizStatus(areaKey);
    let newStatus: Record<number, 'correct' | 'fail' | 'pending'>;
    if (savedStatus) {
      const parsedStatus = savedStatus;
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = parsedStatus[q.index] || 'pending';
          return acc;
        },
        {}
      );
    } else {
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = 'pending';
          return acc;
        },
        {}
      );
    }
    setStatus(newStatus);
    storage.setAreaQuizStatus(areaKey, newStatus);

    // Store selected questions for session restoration
    storage.setAreaSelectedQuestions(
      areaKey,
      orderedQuestions.map((q) => q.index)
    );

    // Always start at the beginning when starting a new section selection
    if (orderedQuestions.length > 0) {
      setCurrent(0);
      setShowStatus(false);
    } else {
      setCurrent(null);
      setShowStatus(true);
    }
    setShowResult(null);
    setShowSelectionMenu(false);
    setSelectionMode(null);
  }, [
    allQuestions,
    selectedSections,
    selectedArea,
    shuffleQuestions,
    setQuestions,
    setStatus,
    setCurrent,
    setShowStatus,
    setShowResult,
    setShowSelectionMenu,
    setSelectionMode,
  ]);

  // Start quiz with selected questions
  const startQuizQuestions = useCallback(() => {
    if (!selectedArea) return;

    const areaKey = selectedArea.shortName;
    const filtered = allQuestions.filter((q) => selectedQuestions.has(q.index));
    if (filtered.length === 0) return;

    const orderedQuestions = [...filtered];

    // Apply ordering based on shuffleQuestions setting
    if (shuffleQuestions) {
      // Use time-based randomization for better variation
      const seed = Date.now() + Math.random();
      let random = Math.sin(seed) * 10000;
      random = random - Math.floor(random);

      // Fisher-Yates shuffle with time-based seeding
      for (let i = orderedQuestions.length - 1; i > 0; i--) {
        // Generate next pseudo-random number in sequence
        random = (random * 9301 + 49297) % 233280;
        const j = Math.floor((random / 233280) * (i + 1));
        [orderedQuestions[i], orderedQuestions[j]] = [orderedQuestions[j], orderedQuestions[i]];
      }
    } else {
      // Sequential: sort by question number
      orderedQuestions.sort((a, b) => a.number - b.number);
    }

    setQuestions(orderedQuestions);

    // Load or initialize status
    const savedStatus = storage.getAreaQuizStatus(areaKey);
    let newStatus: Record<number, 'correct' | 'fail' | 'pending'>;
    if (savedStatus) {
      const parsedStatus = savedStatus;
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = parsedStatus[q.index] || 'pending';
          return acc;
        },
        {}
      );
    } else {
      newStatus = orderedQuestions.reduce(
        (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
          acc[q.index] = 'pending';
          return acc;
        },
        {}
      );
    }
    setStatus(newStatus);
    storage.setAreaQuizStatus(areaKey, newStatus);

    // Store selected questions for session restoration
    storage.setAreaSelectedQuestions(
      areaKey,
      orderedQuestions.map((q) => q.index)
    );

    // Always start at the beginning when starting a new question selection
    if (orderedQuestions.length > 0) {
      setCurrent(0);
      setShowStatus(false);
    } else {
      setCurrent(null);
      setShowStatus(true);
    }
    setShowResult(null);
    setShowSelectionMenu(false);
    setSelectionMode(null);
  }, [
    allQuestions,
    selectedQuestions,
    selectedArea,
    shuffleQuestions,
    setQuestions,
    setStatus,
    setCurrent,
    setShowStatus,
    setShowResult,
    setShowSelectionMenu,
    setSelectionMode,
  ]);

  // Reset quiz
  const resetQuiz = useCallback(() => {
    // Clear any persisted state to ensure fresh randomization
    if (selectedArea) {
      const areaKey = selectedArea.shortName;
      storage.setAreaQuizStatus(areaKey, undefined);
      storage.setAreaCurrentQuestion(areaKey, undefined);
      storage.setAreaSelectedSections(areaKey, undefined);
      storage.setAreaSelectedQuestions(areaKey, undefined);
    }

    setShowSelectionMenu(true);
    setShowStatus(false);
    setShowResult(null);
    setCurrent(null);
    setQuestions([]);
    setSelectionMode(null);
    setSelectedSections(new Set());
    setSelectedQuestions(new Set());
  }, [
    selectedArea,
    setShowSelectionMenu,
    setShowStatus,
    setShowResult,
    setCurrent,
    setQuestions,
    setSelectionMode,
    setSelectedSections,
    setSelectedQuestions,
  ]);

  return {
    startQuizAll,
    startQuizSections,
    startQuizQuestions,
    resetQuiz,
  };
}
