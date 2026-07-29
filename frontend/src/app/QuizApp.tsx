'use client';
import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { QuestionType, AreaType } from './types';
import { shuffleOptionsWithMemory, createSeededRng, getUserDisplayName } from './utils';
import packageJson from '../../package.json';
import { AreaSelection } from './components/AreaSelection';
import { AreaConfiguration } from './components/AreaConfiguration';
import { LoadingSpinner } from './components/LoadingSpinner';
import { SelectionMenu } from './components/SelectionMenu';
import { SectionSelection } from './components/SectionSelection';
import { QuestionSelection } from './components/QuestionSelection';
import { StatusGrid } from './components/StatusGrid';
import { QuestionDisplay } from './components/QuestionDisplay';
import { ResultDisplay } from './components/ResultDisplay';
import { useAuth } from './hooks/useAuth';
import {
  trackAreaSelection,
  trackQuizStart,
  trackQuizComplete,
  trackAnswerSubmit,
  trackAuth,
} from './lib/analytics';

import { useQuizPersistence } from './hooks/useQuizPersistence';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useQuizLogic } from './hooks/useQuizLogic';
import { useLearningStateSync } from './hooks/useLearningStateSync';
import { LEARNING_STUDIO_STATE_CHANGED_EVENT, storage } from './storage';
import { getLearningState, getLearningStateForAuthBootstrap } from './learningStateApi';
import { isRemoteLearningStateReadEnabled } from './persistenceMode';
import {
  orderAreasByConfiguredShortNames,
  sanitizeConfiguredAreaShortNames,
  shouldForceAreaConfiguration,
} from './areaConfig';
import { normalizeAreasPayload, normalizeQuestionsPayload } from './contentPayload';
import { useI18n } from './i18n/I18nProvider';
import { AppLanguage, isLanguageSelectionEnabled } from './i18n/config';
import { normalizeTrueFalseValue } from './trueFalse';

interface AreaConfigUser {
  username?: string;
  isGuest?: boolean;
  attributes?: {
    sub?: string;
    email?: string;
  };
}

function normalizeUserKey(key: string): string {
  return key.trim().toLowerCase();
}

function buildLanguageScopedUserKey(userKey: string, language: AppLanguage): string {
  return `${userKey}::lang:${language}`;
}

function resolveAllowedAreasForUser(
  userKey: string,
  language: AppLanguage,
  areaConfigEntries: Array<[string, { allowedAreaShortNames?: string[] } | undefined]>
): string[] | undefined {
  const languageScopedUserKey = buildLanguageScopedUserKey(userKey, language);
  const exactLanguageScoped = areaConfigEntries.find(([key]) => key === languageScopedUserKey)?.[1]
    ?.allowedAreaShortNames;
  if (exactLanguageScoped?.length) return exactLanguageScoped;
  const hasAnyLanguageScopedConfig = areaConfigEntries.some(([key]) =>
    key.startsWith(`${userKey}::lang:`)
  );
  if (hasAnyLanguageScopedConfig) return undefined;

  const exact = areaConfigEntries.find(([key]) => key === userKey)?.[1]?.allowedAreaShortNames;
  if (exact?.length) return exact;

  const normalizedUserKey = normalizeUserKey(userKey);
  const prefixed = areaConfigEntries.find(([key]) => key === `USER#${userKey}`)?.[1]
    ?.allowedAreaShortNames;
  if (prefixed?.length) return prefixed;

  const bySuffix = areaConfigEntries.find(([key]) => {
    const tail = key.split('#').pop();
    return tail ? normalizeUserKey(tail) === normalizedUserKey : false;
  })?.[1]?.allowedAreaShortNames;
  if (bySuffix?.length) return bySuffix;

  if (normalizedUserKey.includes('@')) {
    const byEmailContainment = areaConfigEntries.find(([key]) =>
      normalizeUserKey(key).includes(normalizedUserKey)
    )?.[1]?.allowedAreaShortNames;
    if (byEmailContainment?.length) return byEmailContainment;
  }

  if (areaConfigEntries.length === 1) {
    const only = areaConfigEntries[0][1]?.allowedAreaShortNames;
    if (only?.length) return only;
  }

  return undefined;
}

function getAreaConfigUserKey(user: AreaConfigUser | null): string | null {
  if (!user || user.isGuest) return null;
  const attributes = user.attributes || {};
  return attributes.sub || attributes.email || user.username || null;
}

export default function QuizApp() {
  const { t, activeLanguage, setActiveLanguage } = useI18n();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const languageSelectionEnabled = isLanguageSelectionEnabled();
  const [clientPathname, setClientPathname] = useState<string>('/');
  const [clientSearch, setClientSearch] = useState<string>('');
  const normalizePathname = useCallback(
    (pathInput: string) => {
      const normalizedInput = (pathInput || '/').replace(/\/+$/, '') || '/';
      const cleanBase = basePath.replace(/\/$/, '');
      if (cleanBase && normalizedInput.startsWith(cleanBase)) {
        const trimmed = normalizedInput.slice(cleanBase.length);
        return trimmed || '/';
      }
      return normalizedInput;
    },
    [basePath]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncPathFromLocation = () => {
      setClientPathname(window.location.pathname || '/');
      setClientSearch(window.location.search || '');
    };
    syncPathFromLocation();
    window.addEventListener('popstate', syncPathFromLocation);
    return () => {
      window.removeEventListener('popstate', syncPathFromLocation);
    };
  }, []);

  const replaceStudioPath = useCallback(
    (targetPath: string, search = '') => {
      if (typeof window === 'undefined') return;
      const cleanBase = basePath.replace(/\/$/, '');
      const normalizedTargetPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
      const nextPathname = cleanBase ? `${cleanBase}${normalizedTargetPath}` : normalizedTargetPath;
      const nextSearch = search ? (search.startsWith('?') ? search : `?${search}`) : '';
      if (window.location.pathname !== nextPathname) {
        window.history.replaceState(
          window.history.state,
          '',
          `${nextPathname}${nextSearch}${window.location.hash}`
        );
      } else if (window.location.search !== nextSearch) {
        window.history.replaceState(window.history.state, '', `${nextPathname}${nextSearch}`);
      }
      setClientPathname(nextPathname);
      setClientSearch(nextSearch);
    },
    [basePath]
  );

  const normalizedPathname = useMemo(() => {
    return normalizePathname(clientPathname);
  }, [clientPathname, normalizePathname]);
  const isConfigureRoute = normalizedPathname === '/areas/configure';
  const isAreasRoute = normalizedPathname === '/areas';
  const isQuizSectionsRoute = normalizedPathname === '/quiz/sections';
  const isQuizQuestionsRoute = normalizedPathname === '/quiz/questions';
  const isQuizStatusQuestionRoute = normalizedPathname === '/quiz/status/question';
  const statusQuestionNumberFromRoute = useMemo(() => {
    if (!isQuizStatusQuestionRoute) return null;
    try {
      const params = new URLSearchParams(clientSearch);
      const value = Number(params.get('questionNumber'));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }, [clientSearch, isQuizStatusQuestionRoute]);
  const isQuizStatusRoute = normalizedPathname === '/quiz/status' || isQuizStatusQuestionRoute;

  // Auth hook
  const { user, logout, isAuthenticated, isLoading } = useAuth();

  // Track user answers for each question (index -> answer string)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const canResumeRef = useRef(false);
  const [allQuestions, setAllQuestions] = useState<QuestionType[]>([]); // All loaded questions
  const [questions, setQuestions] = useState<QuestionType[]>([]); // Filtered questions for this session
  const [status, setStatus] = useState<Record<number, 'correct' | 'fail' | 'pending'>>({});
  // 'current' is the index in the filtered 'questions' array
  const [current, setCurrent] = useState<number | null>(null);
  const [showStatus, setShowStatus] = useState<boolean>(false);
  const [showResult, setShowResult] = useState<null | { correct: boolean; explanation: string }>(
    null
  );
  const [showSelectionMenu, setShowSelectionMenu] = useState<boolean>(true);
  const [selectionMode, setSelectionMode] = useState<null | 'all' | 'sections' | 'questions'>(null);
  const previousAnswerOrderRef = useRef<Record<number, string[]>>({});
  const currentAnswerOrderRef = useRef<Record<number, string[]>>({});
  const answerShuffleSeedRef = useRef(0);
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set());
  const questionScrollRef = useRef<HTMLDivElement | null>(null);
  const [questionScrollMeta, setQuestionScrollMeta] = useState<{
    thumbTop: number;
    thumbHeight: number;
    show: boolean;
  }>({ thumbTop: 0, thumbHeight: 0, show: false });
  const resumeQuestionRef = useRef<number | null>(null);
  const currentLoadingAreaRef = useRef<string | null>(null);
  const areasRequestSeqRef = useRef(0);
  const autoConfigureRedirectRef = useRef(false);
  const manualConfigureNavigationRef = useRef(false);
  const directBootstrapAttemptedRef = useRef(false);
  const preferredLanguageInitializedRef = useRef(false);
  const routeLanguageOverrideInitializedRef = useRef(false);
  const routeLanguageOverrideRef = useRef<AppLanguage | undefined>(undefined);

  const dataBaseUrl =
    process.env.NEXT_PUBLIC_DATA_BASE_URL || process.env.NEXT_PUBLIC_BASE_PATH || '';

  const buildDataUrl = useCallback(
    (pathOrUrl: string) => {
      if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('//')) {
        return pathOrUrl;
      }
      const base = dataBaseUrl.replace(/\/$/, '');
      const path = pathOrUrl.replace(/^\//, '');
      if (!base) {
        return pathOrUrl;
      }
      return `${base}/${path}`;
    },
    [dataBaseUrl]
  );

  const safeLocalStorage = useMemo(
    () => ({
      get(key: string) {
        try {
          if (typeof window === 'undefined') return null;
          return window.localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set(key: string, value: string) {
        try {
          if (typeof window === 'undefined') return;
          window.localStorage.setItem(key, value);
        } catch {
          return;
        }
      },
    }),
    []
  );

  const isGuestUser = Boolean(user?.isGuest);
  const canConfigureAreas = isAuthenticated && !isGuestUser;
  const remoteLearningStateReadEnabled = isRemoteLearningStateReadEnabled();
  const areaConfigUserKey = useMemo(() => getAreaConfigUserKey(user), [user]);
  const languageScopedAreaConfigUserKey = useMemo(() => {
    if (!areaConfigUserKey) return null;
    return buildLanguageScopedUserKey(areaConfigUserKey, activeLanguage);
  }, [areaConfigUserKey, activeLanguage]);

  const fetchJsonWithCache = useCallback(
    async (url: string) => {
      const etagKey = `data-etag:${url}`;
      const cacheKey = `data-cache:${url}`;
      const cachedEtag = safeLocalStorage.get(etagKey);
      const headers: HeadersInit = {};
      if (cachedEtag) {
        headers['If-None-Match'] = cachedEtag;
      }

      // Retry transient failures (network errors, 5xx) with backoff. Without
      // this, a single blip on a CDN/origin edge case leaves the loading
      // spinner stuck forever - nothing else in this chain has a timeout or
      // fallback, so a failed fetch here was a dead end (bug found 2026-07-29:
      // an intermittent 503 on studio-data hung the quiz page indefinitely).
      const maxAttempts = 3;
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
        }
        try {
          const response = await fetch(url, {
            headers,
            cache: 'no-cache',
          });

          if (response.status === 304) {
            const cached = safeLocalStorage.get(cacheKey);
            if (cached) {
              return JSON.parse(cached);
            }
          }

          if (!response.ok) {
            // 4xx won't be fixed by retrying; only retry server/transient errors.
            if (response.status < 500) {
              throw new Error(`Error ${response.status}: ${response.statusText}`);
            }
            lastError = new Error(`Error ${response.status}: ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          const etag = response.headers?.get?.('ETag');
          if (etag) {
            safeLocalStorage.set(etagKey, etag);
          }
          safeLocalStorage.set(cacheKey, JSON.stringify(data));
          return data;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Failed to fetch after retries');
    },
    [safeLocalStorage]
  );

  // New area-related state
  const [areas, setAreas] = useState<AreaType[]>([]);
  const [areasLoaded, setAreasLoaded] = useState(false);
  const [visibleAreas, setVisibleAreas] = useState<AreaType[]>([]);
  const [visibleAreasReady, setVisibleAreasReady] = useState(false);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [guestAllowedAreaShortNames, setGuestAllowedAreaShortNames] = useState<string[] | null>(
    null
  );
  const [userAllowedAreaShortNames, setUserAllowedAreaShortNames] = useState<string[] | undefined>(
    undefined
  );
  const [hasExistingLearningState, setHasExistingLearningState] = useState(false);
  const [learningStateBootstrapCompleted, setLearningStateBootstrapCompleted] = useState(false);
  const [userAreaConfigLoaded, setUserAreaConfigLoaded] = useState(false);
  const [selectedArea, setSelectedArea] = useState<AreaType | null>(null);
  const [showAreaSelection, setShowAreaSelection] = useState<boolean>(true);
  const [showAreaConfiguration, setShowAreaConfiguration] = useState<boolean>(false);
  const [initialRouteResolved, setInitialRouteResolved] = useState(false);
  const [currentQuizType, setCurrentQuizType] = useState<'True False' | 'Multiple Choice' | null>(
    null
  );

  // Shuffle questions toggle state
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(true); // true = random, false = sequential
  // Shuffle answers toggle state
  const [shuffleAnswers, setShuffleAnswers] = useState<boolean>(false);

  // Compute displayOptions for MCQ at the top level, using useMemo at the component level
  const displayOptions = useMemo(() => {
    if (
      current === null ||
      currentQuizType !== 'Multiple Choice' ||
      !questions[current] ||
      !Array.isArray(questions[current].options)
    ) {
      return [];
    }

    const q = questions[current];
    const baseOptions = q.options ?? [];

    if (shuffleAnswers && baseOptions.length > 1) {
      const cachedOrder = currentAnswerOrderRef.current[q.index];
      if (cachedOrder) {
        return cachedOrder;
      }
      const previousOrder = previousAnswerOrderRef.current[q.index];
      const rng = createSeededRng(answerShuffleSeedRef.current * 977 + q.index * 131);
      const nextOrder = shuffleOptionsWithMemory(baseOptions, previousOrder, rng);
      currentAnswerOrderRef.current[q.index] = nextOrder;
      return nextOrder;
    }

    const sequentialOrder = [...baseOptions];
    currentAnswerOrderRef.current[q.index] = sequentialOrder;
    return sequentialOrder;
  }, [current, currentQuizType, questions, shuffleAnswers]);

  // Use custom hooks for persistence, keyboard shortcuts, and quiz logic
  useQuizPersistence(
    selectedArea,
    current,
    shuffleQuestions,
    setShuffleQuestions,
    shuffleAnswers,
    setShuffleAnswers,
    status,
    questions.length
  );

  const loadAreas = () => {
    const requestSeq = ++areasRequestSeqRef.current;
    const languageSnapshot = activeLanguage;
    setAreasError(null); // Clear any previous errors
    setAreasLoaded(false);

    // Support custom areas file via env var or ?areas= query param
    let areasFile = process.env.NEXT_PUBLIC_AREAS_FILE || 'areas.json';
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('areas')) {
        areasFile = params.get('areas')!;
      }
    }
    const areasUrl = buildDataUrl(areasFile);
    fetchJsonWithCache(areasUrl)
      .then((areasData: unknown) => {
        if (requestSeq !== areasRequestSeqRef.current) {
          return;
        }
        const normalized = normalizeAreasPayload(areasData, languageSnapshot);
        setAreas(normalized.areas);
        setGuestAllowedAreaShortNames(normalized.guestAllowedAreaShortNames);
        setAreasError(null);
        setAreasLoaded(true);
      })
      .catch((err) => {
        if (requestSeq !== areasRequestSeqRef.current) {
          return;
        }
        console.error('Failed to load areas:', err);
        setAreasError(err.message || t('areas.errorFallback'));
        setAreasLoaded(true);
      });
  };

  // Load areas on component mount
  useEffect(() => {
    loadAreas();
  }, [activeLanguage]);

  useEffect(() => {
    if (routeLanguageOverrideInitializedRef.current) return;
    routeLanguageOverrideInitializedRef.current = true;
    const routeOverrideLanguage = storage.consumeRouteLanguageOverride();
    if (!routeOverrideLanguage) return;
    routeLanguageOverrideRef.current = routeOverrideLanguage;
    storage.setLanguage(routeOverrideLanguage);
    if (routeOverrideLanguage !== activeLanguage) {
      setActiveLanguage(routeOverrideLanguage);
    }
  }, [activeLanguage, setActiveLanguage]);

  useEffect(() => {
    if (preferredLanguageInitializedRef.current) return;
    preferredLanguageInitializedRef.current = true;
    if (routeLanguageOverrideRef.current) return;
    const persistedLanguage = storage.getLanguage();
    if (persistedLanguage && persistedLanguage !== activeLanguage) {
      setActiveLanguage(persistedLanguage);
    }
  }, [activeLanguage, setActiveLanguage]);

  const syncUserAreaConfigFromStorage = useCallback(() => {
    if (!canConfigureAreas || !areaConfigUserKey || !languageScopedAreaConfigUserKey) {
      setUserAllowedAreaShortNames(undefined);
      setHasExistingLearningState(false);
      setUserAreaConfigLoaded(!canConfigureAreas);
      return;
    }

    const snapshot = storage.getStateSnapshot();
    const areaConfigEntries = Object.entries(snapshot.areaConfigByUser ?? {}).filter(
      ([, cfg]) =>
        Boolean(cfg) &&
        Array.isArray(cfg?.allowedAreaShortNames) &&
        (cfg?.allowedAreaShortNames?.length ?? 0) > 0
    );
    let allowedAreas = storage.getUserAllowedAreas(languageScopedAreaConfigUserKey);

    // Fallback for key-mismatch scenarios (email/sub formats, legacy non-language keys).
    if (!allowedAreas) {
      const resolved = resolveAllowedAreasForUser(
        areaConfigUserKey,
        activeLanguage,
        areaConfigEntries
      );
      if (resolved?.length) {
        allowedAreas = resolved;
        storage.setUserAllowedAreas(languageScopedAreaConfigUserKey, resolved);
      }
    }

    setUserAllowedAreaShortNames(allowedAreas);
    setHasExistingLearningState(Boolean(allowedAreas?.length));
    setUserAreaConfigLoaded(true);
  }, [activeLanguage, canConfigureAreas, areaConfigUserKey, languageScopedAreaConfigUserKey]);

  useEffect(() => {
    if (isLoading) {
      setUserAreaConfigLoaded(false);
      setLearningStateBootstrapCompleted(false);
      return;
    }

    if (canConfigureAreas && !learningStateBootstrapCompleted) {
      setUserAreaConfigLoaded(false);
      return;
    }

    syncUserAreaConfigFromStorage();

    const onStateChanged = () => {
      syncUserAreaConfigFromStorage();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(LEARNING_STUDIO_STATE_CHANGED_EVENT, onStateChanged);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(LEARNING_STUDIO_STATE_CHANGED_EVENT, onStateChanged);
      }
    };
  }, [
    isLoading,
    canConfigureAreas,
    remoteLearningStateReadEnabled,
    learningStateBootstrapCompleted,
    syncUserAreaConfigFromStorage,
  ]);

  useEffect(() => {
    if (!areasLoaded) {
      setVisibleAreas([]);
      setVisibleAreasReady(false);
      return;
    }

    if (!areas.length) {
      setVisibleAreas([]);
      setVisibleAreasReady(true);
      return;
    }

    if (!canConfigureAreas) {
      if (!guestAllowedAreaShortNames || guestAllowedAreaShortNames.length === 0) {
        setVisibleAreas(areas);
        setVisibleAreasReady(true);
        return;
      }
      const guestShortNames = sanitizeConfiguredAreaShortNames(guestAllowedAreaShortNames, areas);
      setVisibleAreas(orderAreasByConfiguredShortNames(areas, guestShortNames));
      setVisibleAreasReady(true);
      return;
    }

    if (!userAllowedAreaShortNames) {
      setVisibleAreas(areas);
      setVisibleAreasReady(true);
      return;
    }

    const configuredShortNames = sanitizeConfiguredAreaShortNames(userAllowedAreaShortNames, areas);
    if (configuredShortNames.length === 0) {
      setVisibleAreas(areas);
      setVisibleAreasReady(true);
      return;
    }
    setVisibleAreas(orderAreasByConfiguredShortNames(areas, configuredShortNames));
    setVisibleAreasReady(true);
  }, [
    areasLoaded,
    areas,
    canConfigureAreas,
    guestAllowedAreaShortNames,
    userAllowedAreaShortNames,
  ]);

  useLayoutEffect(() => {
    if (!isConfigureRoute) return;
    if (!canConfigureAreas) return;
    if (manualConfigureNavigationRef.current) return;
    if (isLoading || !areas.length || !visibleAreasReady) return;
    if (canConfigureAreas && !userAreaConfigLoaded) return;
    if (canConfigureAreas && isAuthenticated && !isGuestUser && !learningStateBootstrapCompleted) {
      return;
    }

    const forceConfiguration = shouldForceAreaConfiguration({
      isAuthenticated,
      isGuest: isGuestUser,
      configuredShortNames: userAllowedAreaShortNames,
      catalogAreas: areas,
      hasExistingLearningState,
    });

    if (!forceConfiguration) {
      replaceStudioPath('/areas');
    }
  }, [
    isConfigureRoute,
    canConfigureAreas,
    isLoading,
    areas,
    visibleAreasReady,
    userAreaConfigLoaded,
    isAuthenticated,
    isGuestUser,
    learningStateBootstrapCompleted,
    userAllowedAreaShortNames,
    hasExistingLearningState,
    replaceStudioPath,
  ]);

  useEffect(() => {
    if (isLoading || !areasLoaded) return;
    if (canConfigureAreas && !userAreaConfigLoaded) return;
    if (!visibleAreasReady) return;
    if (canConfigureAreas && isAuthenticated && !isGuestUser && !learningStateBootstrapCompleted) {
      return;
    }

    const forceConfiguration = shouldForceAreaConfiguration({
      isAuthenticated,
      isGuest: isGuestUser,
      configuredShortNames: userAllowedAreaShortNames,
      catalogAreas: areas,
      hasExistingLearningState,
    });

    if (isConfigureRoute) {
      if (!canConfigureAreas) {
        setInitialRouteResolved(true);
        replaceStudioPath('/areas');
        return;
      }
      if (
        !forceConfiguration &&
        !autoConfigureRedirectRef.current &&
        !manualConfigureNavigationRef.current
      ) {
        setShowAreaConfiguration(false);
        setShowAreaSelection(true);
        setShowSelectionMenu(false);
        setInitialRouteResolved(true);
        replaceStudioPath('/areas');
        return;
      }
      if (autoConfigureRedirectRef.current && !forceConfiguration) {
        autoConfigureRedirectRef.current = false;
        setShowAreaConfiguration(false);
        setShowAreaSelection(true);
        setShowSelectionMenu(false);
        setInitialRouteResolved(true);
        replaceStudioPath('/areas');
        return;
      }
      setShowAreaConfiguration(true);
      setShowAreaSelection(false);
      setShowSelectionMenu(false);
      setInitialRouteResolved(true);
      return;
    }

    if (isQuizSectionsRoute || isQuizQuestionsRoute || isQuizStatusRoute) {
      if (selectedArea) {
        setShowAreaConfiguration(false);
        setShowAreaSelection(false);
        setShowResult(null);

        if (isQuizStatusRoute) {
          setShowSelectionMenu(false);
          setSelectionMode(null);
          setShowStatus(true);
        } else {
          setShowSelectionMenu(true);
          setShowStatus(false);
          setSelectionMode(isQuizSectionsRoute ? 'sections' : 'questions');
        }
        setInitialRouteResolved(true);
        return;
      }

      setShowAreaConfiguration(false);
      setShowAreaSelection(true);
      setShowSelectionMenu(false);
      setShowStatus(false);
      setShowResult(null);
      setInitialRouteResolved(true);
      replaceStudioPath('/areas');
      return;
    }

    if (forceConfiguration) {
      autoConfigureRedirectRef.current = false;
      if (!isConfigureRoute) {
        replaceStudioPath('/areas/configure');
        setInitialRouteResolved(true);
        return;
      }
      setShowAreaConfiguration(true);
      setShowAreaSelection(false);
      setShowSelectionMenu(false);
      setInitialRouteResolved(true);
      return;
    }
    autoConfigureRedirectRef.current = false;

    setShowAreaConfiguration(false);

    if (!selectedArea) {
      if (isAreasRoute) {
        setShowAreaSelection(true);
        setShowSelectionMenu(false);
        setInitialRouteResolved(true);
        return;
      }
      const currentAreaShortName = storage.getCurrentArea();
      const areaToRestore = currentAreaShortName
        ? visibleAreas.find((area) => area.shortName === currentAreaShortName)
        : null;

      if (areaToRestore) {
        const savedStatus = storage.getAreaQuizStatus(areaToRestore.shortName);
        const savedCurrent = storage.getAreaCurrentQuestion(areaToRestore.shortName);
        const hasSavedProgress = Boolean(savedStatus) || savedCurrent !== null;

        setSelectedArea(areaToRestore);
        setCurrentQuizType(areaToRestore.type);
        setShowSelectionMenu(false);
        setShowStatus(false);
        setShowResult(null);
        setSelectionMode(null);
        const savedShuffleQuestions = storage.getAreaShuffleQuestions(areaToRestore.shortName);
        setShuffleQuestions(
          typeof savedShuffleQuestions === 'boolean' ? savedShuffleQuestions : true
        );

        const savedShuffleAnswers = storage.getAreaShuffleAnswers(areaToRestore.shortName);
        setShuffleAnswers(typeof savedShuffleAnswers === 'boolean' ? savedShuffleAnswers : false);
        setShowAreaSelection(false);
        if (normalizedPathname === '/' && hasSavedProgress) {
          replaceStudioPath('/quiz');
        }
        setInitialRouteResolved(true);
        return;
      }
      setShowAreaSelection(true);
      setInitialRouteResolved(true);
      return;
    }

    if (!visibleAreas.some((area) => area.shortName === selectedArea.shortName)) {
      storage.setCurrentArea(undefined);
      setSelectedArea(null);
      setCurrentQuizType(null);
      setQuestions([]);
      setCurrent(null);
      setShowSelectionMenu(false);
      setShowAreaSelection(true);
      setInitialRouteResolved(true);
      return;
    }
    setInitialRouteResolved(true);
  }, [
    isLoading,
    areasLoaded,
    areas,
    visibleAreas,
    isAuthenticated,
    isGuestUser,
    canConfigureAreas,
    learningStateBootstrapCompleted,
    userAreaConfigLoaded,
    visibleAreasReady,
    userAllowedAreaShortNames,
    hasExistingLearningState,
    selectedArea,
    selectionMode,
    isConfigureRoute,
    isAreasRoute,
    isQuizSectionsRoute,
    isQuizQuestionsRoute,
    isQuizStatusRoute,
    replaceStudioPath,
  ]);

  const openAreaConfiguration = useCallback(() => {
    if (!canConfigureAreas) return;
    manualConfigureNavigationRef.current = true;
    replaceStudioPath('/areas/configure');
  }, [canConfigureAreas, replaceStudioPath]);

  const closeAreaConfiguration = useCallback(() => {
    manualConfigureNavigationRef.current = false;
    setShowAreaConfiguration(false);
    setShowAreaSelection(true);
    replaceStudioPath('/areas');
  }, [replaceStudioPath]);

  const goToAreaSelection = useCallback(
    (show = true) => {
      if (!show) {
        setShowAreaSelection(false);
        return;
      }
      setShowAreaConfiguration(false);
      setShowAreaSelection(true);
      setShowSelectionMenu(false);
      setShowStatus(false);
      setShowResult(null);
      replaceStudioPath('/areas');
    },
    [replaceStudioPath]
  );

  const openSectionsSelection = useCallback(() => {
    setSelectionMode('sections');
    setShowSelectionMenu(true);
    setShowStatus(false);
    setShowResult(null);
    replaceStudioPath('/quiz/sections');
  }, [replaceStudioPath]);

  const openQuestionsSelection = useCallback(() => {
    setSelectionMode('questions');
    setShowSelectionMenu(true);
    setShowStatus(false);
    setShowResult(null);
    replaceStudioPath('/quiz/questions');
  }, [replaceStudioPath]);

  const acceptAreaConfiguration = useCallback(
    (shortNames: string[]) => {
      if (!canConfigureAreas || !languageScopedAreaConfigUserKey) return;
      const sanitized = sanitizeConfiguredAreaShortNames(shortNames, areas);
      if (sanitized.length === 0) return;

      storage.setUserAllowedAreas(languageScopedAreaConfigUserKey, sanitized);
      setUserAllowedAreaShortNames(sanitized);
      manualConfigureNavigationRef.current = false;
      setShowAreaConfiguration(false);
      setShowAreaSelection(true);
      setShowSelectionMenu(false);
      replaceStudioPath('/areas');
    },
    [canConfigureAreas, languageScopedAreaConfigUserKey, areas, replaceStudioPath]
  );

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      if (!languageSelectionEnabled) return;

      storage.setLanguage(language);
      setActiveLanguage(language);
      setUserAreaConfigLoaded(false);
      setUserAllowedAreaShortNames(undefined);
      replaceStudioPath('/areas');
    },
    [languageSelectionEnabled, setActiveLanguage, replaceStudioPath]
  );

  const handleServerStateApplied = useCallback(() => {
    loadAreas();
  }, [loadAreas]);

  const isTestRuntime = process.env.NODE_ENV === 'test';

  useLearningStateSync({
    enabled:
      !isTestRuntime &&
      !isLoading &&
      isAuthenticated &&
      !user?.isGuest &&
      remoteLearningStateReadEnabled,
    onServerStateApplied: handleServerStateApplied,
    onBootstrapCompleted: () => {
      syncUserAreaConfigFromStorage();
    },
  });

  useEffect(() => {
    if (isLoading || !isAuthenticated || user?.isGuest) {
      directBootstrapAttemptedRef.current = false;
      return;
    }
    if (directBootstrapAttemptedRef.current) {
      return;
    }
    directBootstrapAttemptedRef.current = true;

    getLearningStateForAuthBootstrap('global')
      .then((remote) => {
        if (remote?.state) {
          storage.replaceState(remote.state);
          const routeOverrideLanguage = routeLanguageOverrideRef.current;
          if (routeOverrideLanguage) {
            storage.setLanguage(routeOverrideLanguage);
            if (routeOverrideLanguage !== activeLanguage) {
              setActiveLanguage(routeOverrideLanguage);
            }
            routeLanguageOverrideRef.current = undefined;
          } else {
            const restoredLanguage = storage.getLanguage();
            if (restoredLanguage && restoredLanguage !== activeLanguage) {
              setActiveLanguage(restoredLanguage);
            }
          }
        }
        syncUserAreaConfigFromStorage();
      })
      .catch((error) => {
        console.error('Direct bootstrap from remote learning state failed', error);
      })
      .finally(() => {
        setLearningStateBootstrapCompleted(true);
      });
  }, [
    activeLanguage,
    isLoading,
    isAuthenticated,
    setActiveLanguage,
    user?.isGuest,
    syncUserAreaConfigFromStorage,
  ]);

  useEffect(() => {
    if (canConfigureAreas && !learningStateBootstrapCompleted) {
      return;
    }
    storage.setLanguage(activeLanguage);
  }, [activeLanguage, canConfigureAreas, learningStateBootstrapCompleted]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || user?.isGuest) return;
    if (!learningStateBootstrapCompleted) return;

    const snapshot = storage.getStateSnapshot();
    const hasLocalState =
      Boolean(snapshot.currentArea) ||
      Object.keys(snapshot.areas ?? {}).length > 0 ||
      Object.keys(snapshot.areaConfigByUser ?? {}).length > 0;
    if (hasLocalState) return;

    getLearningState('global')
      .then((remote) => {
        if (!remote?.state) return;
        storage.replaceState(remote.state);
      })
      .catch((error) => {
        console.error('Failed to apply fallback learning state bootstrap', error);
      });
  }, [isLoading, isAuthenticated, user?.isGuest, learningStateBootstrapCompleted]);

  useEffect(() => {
    previousAnswerOrderRef.current = {};
    currentAnswerOrderRef.current = {};
    answerShuffleSeedRef.current = 0;
  }, [selectedArea]);

  // Reset to the area-selection screen. Used both when loading questions
  // fails outright and as a last-resort watchdog fallback (see below) -
  // avoids the loading spinner ever being a dead end.
  const resetToAreaSelection = useCallback(() => {
    storage.setCurrentArea(undefined);
    setSelectedArea(null);
    setCurrentQuizType(null);
    setShowAreaSelection(true);
    setShowStatus(false);
    setShowResult(null);
    setShowSelectionMenu(true);
    setQuestions([]);
    setCurrent(null);
  }, []);

  // Shared function to load area questions and restore progress
  const loadAreaAndQuestions = async (area: AreaType, forceMenu = false) => {
    // Track the current area being loaded to prevent race conditions
    const loadingId = `${area.shortName}_${Date.now()}`;
    currentLoadingAreaRef.current = loadingId;

    // Reset current state when switching areas to prevent cross-contamination
    setCurrent(null);
    // Reset questions immediately to prevent persistence useEffect from using wrong data
    setQuestions([]);

    setSelectedArea(area);
    setCurrentQuizType(area.type);
    setShowAreaSelection(false);
    // Track area for persistence
    storage.setCurrentArea(area.shortName);

    // Track area selection in Google Analytics
    trackAreaSelection(area.shortName);

    // Always load questions and restore progress if available
    const areaKey = area.shortName;
    const savedStatus = storage.getAreaQuizStatus(areaKey);
    const savedCurrent = storage.getAreaCurrentQuestion(areaKey);
    const savedSelectedQuestions = storage.getAreaSelectedQuestions(areaKey);
    try {
      const areaUrl = buildDataUrl(area.file);
      const questionsData = await fetchJsonWithCache(areaUrl);
      if (currentLoadingAreaRef.current !== loadingId) return;
      if (questionsData) {
        const { questions: normalizedQuestions, language } = normalizeQuestionsPayload(
          questionsData,
          activeLanguage
        );
        if (language !== activeLanguage) {
          throw new Error(
            `Questions file language mismatch: expected ${activeLanguage}, got ${language}`
          );
        }
        const questionsWithIndex = normalizedQuestions.map((q: QuestionType, idx: number) => ({
          ...q,
          index: idx,
        }));
        if (currentLoadingAreaRef.current !== loadingId) return;
        setAllQuestions(questionsWithIndex);
        let parsedStatus: Record<number, 'correct' | 'fail' | 'pending'> = {};
        if (savedStatus) {
          parsedStatus = savedStatus;
        } else {
          parsedStatus = questionsWithIndex.reduce(
            (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
              acc[q.index] = 'pending';
              return acc;
            },
            {}
          );
        }
        setStatus(parsedStatus);

        // Load shuffle preference for this area from localStorage
        const savedShuffleQuestions = storage.getAreaShuffleQuestions(areaKey);
        const shouldShuffleQuestions =
          savedShuffleQuestions !== undefined ? savedShuffleQuestions : true;

        // Order questions according to shuffle preference
        let orderedQuestions = [...questionsWithIndex];
        if (!shouldShuffleQuestions) {
          orderedQuestions.sort((a, b) => a.number - b.number);
        } else {
          // Replace Math.random() with Fisher-Yates shuffle for stable randomization
          function fisherYatesShuffle<T>(array: T[]): T[] {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
          }

          // Use Fisher-Yates shuffle for random order
          orderedQuestions = fisherYatesShuffle(orderedQuestions);
        }

        // If we have saved selected questions, filter to only those questions
        if (savedSelectedQuestions) {
          const selectedIndices = savedSelectedQuestions;
          orderedQuestions = orderedQuestions.filter((q) => selectedIndices.includes(q.index));
        } else if (savedStatus) {
          // Legacy session without savedSelectedQuestions - infer from saved status indices
          const statusIndices = Object.keys(savedStatus).map(Number);
          orderedQuestions = orderedQuestions.filter((q) => statusIndices.includes(q.index));
        }

        // If forced via parameter, always show the menu on area change
        if (forceMenu) {
          setQuestions([]);
          setCurrent(null);
          setShowSelectionMenu(true);
          setSelectionMode(null);
          setShowStatus(false);
          setShowResult(null);
          return;
        }
        // If all questions are answered, show the menu and clean up currentQuestion
        const allAnswered =
          Object.values(parsedStatus).length > 0 &&
          Object.values(parsedStatus).every((s) => s !== 'pending');
        if (allAnswered) {
          storage.setAreaCurrentQuestion(areaKey, undefined);
          setQuestions([]);
          setCurrent(null);
          setShowSelectionMenu(true);
          setSelectionMode(null);
          setShowStatus(false);
          setShowResult(null);
          return;
        }
        // If there is no saved progress, show the selection menu
        if (!savedStatus && !savedCurrent) {
          setQuestions([]);
          setCurrent(null);
          setShowSelectionMenu(true);
          setSelectionMode(null);
          setShowStatus(false);
          setShowResult(null);
          return;
        }
        // Otherwise, resume at the last question or first pending
        let idx = 0;
        if (savedCurrent !== null) {
          const n = Number(savedCurrent);
          if (!isNaN(n) && n >= 0 && n < orderedQuestions.length) {
            idx = n;
          } else {
            // If savedCurrent is out of range, find first pending
            const nextPending = orderedQuestions.findIndex(
              (q) => parsedStatus[q.index] === 'pending'
            );
            if (nextPending !== -1) {
              idx = nextPending;
            }
          }
        } else {
          // If no saved current, try to resume at first pending
          const nextPending = orderedQuestions.findIndex(
            (q) => parsedStatus[q.index] === 'pending'
          );
          if (nextPending !== -1) {
            idx = nextPending;
          }
        }

        setQuestions(orderedQuestions);
        setCurrent(idx);
        setShowSelectionMenu(false);
        setSelectionMode(null);
        setShowStatus(false);
        setShowResult(null);
        return;
      }
    } catch (error) {
      console.error('Failed to load questions:', error);
    }
    // Fail-safe fallback: avoid spinner lock when selected area/questions are inconsistent
    // (e.g. stale/cross-language payload race in deployed caches).
    resetToAreaSelection();
  };

  // Get quiz logic functions from custom hook
  const {
    startQuizAll: baseStartQuizAll,
    startQuizSections: baseStartQuizSections,
    startQuizQuestions: baseStartQuizQuestions,
    resetQuiz,
  } = useQuizLogic({
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
  });

  const prepareNewRun = useCallback(() => {
    // Ensure a new seed for answer shuffling on every run
    answerShuffleSeedRef.current = Math.floor(Math.random() * 1e9);
    // Reset answer order caches so new shuffle is generated for each run
    previousAnswerOrderRef.current = {};
    currentAnswerOrderRef.current = {};
  }, []);

  const startQuizAll = useCallback(() => {
    prepareNewRun();
    setSelectionMode('all');
    baseStartQuizAll();
    replaceStudioPath('/quiz');

    // Track quiz start in Google Analytics
    if (selectedArea) {
      trackQuizStart(selectedArea.shortName, 'all_questions');
    }
  }, [prepareNewRun, baseStartQuizAll, selectedArea, replaceStudioPath]);

  const startQuizSections = useCallback(() => {
    prepareNewRun();
    setSelectionMode('sections');
    baseStartQuizSections();
    replaceStudioPath('/quiz');

    // Track quiz start in Google Analytics
    if (selectedArea) {
      trackQuizStart(selectedArea.shortName, 'sections');
    }
  }, [prepareNewRun, baseStartQuizSections, selectedArea, replaceStudioPath]);

  const startQuizQuestions = useCallback(() => {
    prepareNewRun();
    setSelectionMode('questions');
    baseStartQuizQuestions();
    replaceStudioPath('/quiz');

    // Track quiz start in Google Analytics
    if (selectedArea) {
      trackQuizStart(selectedArea.shortName, 'questions');
    }
  }, [prepareNewRun, baseStartQuizQuestions, selectedArea, replaceStudioPath]);

  const resetQuizWithRoute = useCallback(() => {
    resetQuiz();
    replaceStudioPath('/quiz');
  }, [resetQuiz, replaceStudioPath]);

  // Load questions for selected area on every area change
  useEffect(() => {
    if (!selectedArea) return;
    loadAreaAndQuestions(selectedArea);
  }, [selectedArea]);

  // Keep a visible scroll indicator for the question selection view
  useEffect(() => {
    if (selectionMode !== 'questions') return;

    function updateScrollIndicator() {
      const el = questionScrollRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScrollTop = Math.max(scrollHeight - clientHeight, 0);
      const show = maxScrollTop > 0;
      const trackHeight = clientHeight;
      const thumbHeight = show
        ? Math.max((clientHeight / scrollHeight) * trackHeight, 20)
        : trackHeight;
      const thumbTop =
        show && maxScrollTop > 0 ? (scrollTop / maxScrollTop) * (trackHeight - thumbHeight) : 0;
      setQuestionScrollMeta({ thumbTop, thumbHeight, show });
    }

    const el = questionScrollRef.current;
    updateScrollIndicator();
    if (!el) return;
    el.addEventListener('scroll', updateScrollIndicator);
    window.addEventListener('resize', updateScrollIndicator);
    return () => {
      el.removeEventListener('scroll', updateScrollIndicator);
      window.removeEventListener('resize', updateScrollIndicator);
    };
  }, [selectionMode, allQuestions.length]);

  // Define all functions used in the component
  const pendingQuestions = useCallback(() => {
    return questions
      .map((q, i) => [i, q] as [number, QuestionType])
      .filter(([, q]) => status[q.index] === 'pending');
  }, [questions, status]);

  const loadQuestionsForArea = useCallback(
    async (area: AreaType) => {
      try {
        const areaUrl = buildDataUrl(area.file);
        const questionsData = await fetchJsonWithCache(areaUrl);
        const { questions: normalizedQuestions, language } = normalizeQuestionsPayload(
          questionsData,
          activeLanguage
        );
        if (language !== activeLanguage) {
          throw new Error(
            `Questions file language mismatch: expected ${activeLanguage}, got ${language}`
          );
        }

        // Add indices to questions for tracking
        const questionsWithIndex = normalizedQuestions.map((q: QuestionType, idx: number) => ({
          ...q,
          index: idx,
        }));
        setAllQuestions(questionsWithIndex);

        // Load saved status for this area
        const areaKey = area.shortName;

        const savedStatus = storage.getAreaQuizStatus(areaKey);
        if (savedStatus) {
          setStatus(savedStatus);
        } else {
          // Initialize all questions as pending
          const pendingStatus = questionsWithIndex.reduce(
            (acc: Record<number, 'correct' | 'fail' | 'pending'>, q: QuestionType) => {
              acc[q.index] = 'pending';
              return acc;
            },
            {}
          );
          setStatus(pendingStatus);
        }
      } catch (error) {
        console.error('Error loading questions:', error);
        setAllQuestions([]);
        setStatus({});
      }
    },
    [activeLanguage, buildDataUrl, fetchJsonWithCache]
  );
  // Area selection UI
  function renderAreaSelection() {
    if (areasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <div className="max-w-md w-full bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <div className="text-red-600 dark:text-red-400 mb-4">
              <svg
                className="w-12 h-12 mx-auto mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h2 className="text-lg font-semibold mb-2">{t('areas.errorTitle')}</h2>
              <p className="text-sm text-red-600 dark:text-red-300 mb-4">{areasError}</p>
              <button
                onClick={loadAreas}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200"
              >
                {t('common.retry')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <AreaSelection
        areas={visibleAreas}
        loadAreaAndQuestions={loadAreaAndQuestions}
        canConfigureAreas={canConfigureAreas}
        onConfigureAreas={openAreaConfiguration}
        languageSelectionEnabled={languageSelectionEnabled}
        activeLanguage={activeLanguage}
        onLanguageChange={handleLanguageChange}
      />
    );
  }

  function renderAreaConfiguration() {
    return (
      <AreaConfiguration
        areas={areas}
        initialSelectedShortNames={
          canConfigureAreas
            ? sanitizeConfiguredAreaShortNames(userAllowedAreaShortNames, areas)
            : []
        }
        onAccept={acceptAreaConfiguration}
        onCancel={closeAreaConfiguration}
        allowCancel={
          !shouldForceAreaConfiguration({
            isAuthenticated,
            isGuest: isGuestUser,
            configuredShortNames: userAllowedAreaShortNames,
            catalogAreas: areas,
            hasExistingLearningState,
          })
        }
      />
    );
  }

  // Selection menu UI
  function renderSelectionMenu() {
    return (
      <SelectionMenu
        currentQuizType={currentQuizType}
        selectedArea={selectedArea}
        shuffleQuestions={shuffleQuestions}
        setShuffleQuestions={setShuffleQuestions}
        shuffleAnswers={shuffleAnswers}
        setShuffleAnswers={setShuffleAnswers}
        startQuizAll={startQuizAll}
        openSectionsSelection={openSectionsSelection}
        openQuestionsSelection={openQuestionsSelection}
        setShowAreaSelection={goToAreaSelection}
        setShowSelectionMenu={setShowSelectionMenu}
      />
    );
  }

  // Section selection UI
  function renderSectionSelection() {
    return (
      <SectionSelection
        selectedArea={selectedArea}
        allQuestions={allQuestions}
        selectedSections={selectedSections}
        setSelectedSections={setSelectedSections}
        startQuizSections={startQuizSections}
        resetQuiz={resetQuizWithRoute}
      />
    );
  }

  // Question selection UI
  function renderQuestionSelection() {
    return (
      <QuestionSelection
        selectedArea={selectedArea}
        allQuestions={allQuestions}
        selectedQuestions={selectedQuestions}
        setSelectedQuestions={setSelectedQuestions}
        questionScrollRef={questionScrollRef}
        questionScrollMeta={questionScrollMeta}
        startQuizQuestions={startQuizQuestions}
        resetQuiz={resetQuizWithRoute}
      />
    );
  }

  const handleAnswer = useCallback(
    (ans: string) => {
      if (current == null || !selectedArea) return;
      const q = questions[current];
      const expected = q.answer.trim().toUpperCase();
      const user = ans.trim().toUpperCase();

      let correct = false;
      let answerToStore = ans;

      if (currentQuizType === 'True False') {
        const normalizedExpected = normalizeTrueFalseValue(expected);
        const normalizedUser = normalizeTrueFalseValue(user);
        correct =
          normalizedExpected !== null &&
          normalizedUser !== null &&
          normalizedExpected === normalizedUser;
      } else if (currentQuizType === 'Multiple Choice') {
        const userLetter = user.toLowerCase();
        const userIndex = userLetter.charCodeAt(0) - 97;
        const userAnswer = displayOptions[userIndex] || '';
        correct = userAnswer === q.answer;
        answerToStore = userAnswer;
      }

      const newStatus: Record<number, 'correct' | 'fail' | 'pending'> = {
        ...status,
        [q.index]: correct ? 'correct' : 'fail',
      };
      setStatus(newStatus);
      setUserAnswers((prev) => ({ ...prev, [q.index]: answerToStore }));
      const areaKey = selectedArea.shortName;
      storage.setAreaQuizStatus(areaKey, newStatus);
      setShowResult({ correct, explanation: q.explanation });

      // Track answer submission in Google Analytics
      if (currentQuizType) {
        trackAnswerSubmit(selectedArea.shortName, currentQuizType, correct);
      }
    },
    [current, questions, status, selectedArea, currentQuizType, displayOptions]
  );

  const nextQuestion = useCallback(() => {
    const pending = pendingQuestions();
    if (pending.length === 0) {
      // Quiz completed - track completion in Google Analytics
      if (selectedArea && status) {
        const totalQuestions = questions.length;
        const correctAnswers = Object.values(status).filter((s) => s === 'correct').length;
        const quizType = selectionMode || 'unknown';

        trackQuizComplete(selectedArea.shortName, String(quizType), correctAnswers, totalQuestions);
      }

      setShowStatus(false);
      setCurrent(null);
      setShowResult(null);
      return;
    }
    let nextIdx: number | null = null;
    if (!shuffleQuestions) {
      // Find the next higher-numbered pending question after current, or the lowest if at end
      // Get all pending questions sorted by .number
      const pendingSorted = pending
        .map(([idx, q]) => ({ idx, number: q.number }))
        .sort((a, b) => a.number - b.number);
      // Find the next higher-numbered pending
      let found = false;
      for (let i = 0; i < pendingSorted.length; ++i) {
        if (
          current !== null &&
          questions[current] &&
          pendingSorted[i].number > questions[current].number
        ) {
          nextIdx = pendingSorted[i].idx;
          found = true;
          break;
        }
      }
      if (!found) {
        // If none found, go to the lowest-numbered pending
        nextIdx = pendingSorted.length > 0 ? pendingSorted[0].idx : null;
      }
    } else {
      // Random order
      if (pending.length > 0) {
        [nextIdx] = pending[Math.floor(Math.random() * pending.length)];
      } else {
        nextIdx = null;
      }
    }
    setCurrent(nextIdx ?? null);
    setShowStatus(false);
    setShowResult(null);
    if (isQuizStatusRoute) {
      replaceStudioPath('/quiz');
    }
  }, [
    pendingQuestions,
    current,
    questions,
    shuffleQuestions,
    selectedArea,
    status,
    selectionMode,
    isQuizStatusRoute,
    replaceStudioPath,
  ]);

  const handleContinue = useCallback(
    (action: string) => {
      if (action === 'C' && showResult) {
        resumeQuestionRef.current = null;
        canResumeRef.current = false;
        nextQuestion();
        return;
      }
      if (action === 'E') {
        if (!showResult && current !== null) {
          resumeQuestionRef.current = current;
          canResumeRef.current = true;
        } else {
          resumeQuestionRef.current = null;
          canResumeRef.current = false;
        }
        setShowAreaSelection(false);
        setShowSelectionMenu(false);
        setShowStatus(true);
        setShowResult(null);
        replaceStudioPath('/quiz/status');
      } else {
        if (resumeQuestionRef.current !== null && canResumeRef.current) {
          setShowStatus(false);
          setCurrent(resumeQuestionRef.current);
          replaceStudioPath('/quiz');
          resumeQuestionRef.current = null;
          canResumeRef.current = false;
        } else {
          resumeQuestionRef.current = null;
          canResumeRef.current = false;
          nextQuestion();
        }
      }
    },
    [showResult, current, nextQuestion, replaceStudioPath]
  );

  // Helper to go to status and enable resume (only from question view)
  const goToStatusWithResume = useCallback(() => {
    if (current !== null) {
      resumeQuestionRef.current = current;
      canResumeRef.current = true;
    }
    setShowAreaSelection(false);
    setShowSelectionMenu(false);
    setShowStatus(true);
    setShowResult(null);
    replaceStudioPath('/quiz/status');
  }, [current, replaceStudioPath]);

  const openFailedQuestionDetail = useCallback(
    (questionNumber: number) => {
      setShowAreaSelection(false);
      setShowSelectionMenu(false);
      setShowStatus(true);
      setShowResult(null);
      replaceStudioPath('/quiz/status/question', `questionNumber=${questionNumber}`);
    },
    [replaceStudioPath]
  );

  const closeFailedQuestionDetail = useCallback(() => {
    replaceStudioPath('/quiz/status');
  }, [replaceStudioPath]);

  // Status grid rendering
  function renderStatusGrid() {
    // Calculate original section order from allQuestions to maintain consistent ordering
    const originalSectionOrder = Array.from(new Set(allQuestions.map((q) => q.section)));

    return (
      <StatusGrid
        selectedArea={selectedArea}
        questions={questions}
        status={status}
        userAnswers={userAnswers}
        currentQuizType={currentQuizType}
        handleContinue={handleContinue}
        pendingQuestions={pendingQuestions}
        resetQuiz={resetQuizWithRoute}
        setShowAreaSelection={goToAreaSelection}
        setShowStatus={setShowStatus}
        setShowResult={setShowResult}
        originalSectionOrder={originalSectionOrder}
        selectedFailedQuestionNumber={statusQuestionNumberFromRoute}
        onOpenFailedQuestion={openFailedQuestionDetail}
        onCloseFailedQuestion={closeFailedQuestionDetail}
      />
    );
  }

  // Question rendering
  function renderQuestion() {
    return (
      <QuestionDisplay
        selectedArea={selectedArea}
        current={current}
        questions={questions}
        status={status}
        currentQuizType={currentQuizType}
        displayOptions={displayOptions}
        handleAnswer={handleAnswer}
        goToStatusWithResume={goToStatusWithResume}
      />
    );
  }

  // Result rendering
  // If all questions are answered, show only the results grid
  // Use keyboard shortcuts custom hook
  useKeyboardShortcuts({
    showAreaSelection,
    areas: visibleAreas,
    setSelectedArea,
    setCurrentQuizType,
    setShowAreaSelection: goToAreaSelection,
    setShowSelectionMenu,
    loadQuestionsForArea,
    showSelectionMenu,
    selectionMode,
    setSelectionMode,
    startQuizAll,
    startQuizSections,
    startQuizQuestions,
    selectedSections,
    selectedQuestions,
    showStatus,
    showResult,
    current,
    questions,
    currentQuizType,
    handleAnswer,
    goToStatusWithResume,
    handleContinue,
    resetQuiz: resetQuizWithRoute,
    pendingQuestions,
  });

  const allAnswered =
    questions.length > 0 && Object.values(status).filter((s) => s === 'pending').length === 0;

  // Watchdog: mirrors the "loading questions" spinner condition in
  // renderContent() below. If we're stuck there for too long, force a
  // reset instead of leaving the user on an infinite spinner. This is a
  // last-resort backstop on top of loadAreaAndQuestions' own try/catch
  // fallback - found 2026-07-29 after an intermittent CDN/origin failure
  // left the app stuck on "Loading..." indefinitely with no recovery path.
  useEffect(() => {
    const isLoadingQuestions =
      !showAreaSelection &&
      !!selectedArea &&
      !questions.length &&
      !showSelectionMenu &&
      !showResult &&
      !showStatus &&
      !allAnswered;

    if (!isLoadingQuestions) return;

    const timer = setTimeout(() => {
      console.error('Timed out loading questions - resetting to area selection');
      resetToAreaSelection();
    }, 15000);

    return () => clearTimeout(timer);
  }, [
    showAreaSelection,
    selectedArea,
    questions.length,
    showSelectionMenu,
    showResult,
    showStatus,
    allAnswered,
    resetToAreaSelection,
  ]);

  const renderContent = () => {
    const isAuthBootstrapPending = canConfigureAreas && !learningStateBootstrapCompleted;

    if (isAuthBootstrapPending) {
      return <LoadingSpinner />;
    }

    if ((!initialRouteResolved || (areas.length > 0 && !visibleAreasReady)) && !areasError) {
      return <LoadingSpinner />;
    }

    // Show spinner only while areas are loading, not when result is empty.
    if (!areasLoaded && !areasError) {
      return <LoadingSpinner />;
    }

    // Route-driven views take precedence to avoid state/routing races.
    if (isQuizStatusRoute) {
      if (!selectedArea) return <LoadingSpinner />;
      return renderStatusGrid();
    }
    if (isQuizSectionsRoute) {
      if (!selectedArea) return <LoadingSpinner />;
      return renderSectionSelection();
    }
    if (isQuizQuestionsRoute) {
      if (!selectedArea) return <LoadingSpinner />;
      return renderQuestionSelection();
    }

    if (showAreaConfiguration) {
      return renderAreaConfiguration();
    }
    // Show spinner if questions are loading after area selection
    if (
      !showAreaSelection &&
      selectedArea &&
      !questions.length &&
      !showSelectionMenu &&
      !showResult &&
      !showStatus &&
      !allAnswered
    ) {
      return <LoadingSpinner />;
    }
    if (showAreaSelection) {
      return renderAreaSelection();
    }
    if (showSelectionMenu) {
      if (selectionMode === 'sections') {
        return renderSectionSelection();
      }
      if (selectionMode === 'questions') {
        return renderQuestionSelection();
      }
      return renderSelectionMenu();
    }
    if (showResult) {
      return (
        <ResultDisplay
          selectedArea={selectedArea}
          questions={questions}
          current={current}
          currentQuizType={currentQuizType}
          showResult={showResult}
          status={status}
          userAnswers={userAnswers}
          handleContinue={handleContinue}
          resetQuiz={resetQuizWithRoute}
        />
      );
    }
    if (allAnswered) {
      return (
        <ResultDisplay
          selectedArea={selectedArea}
          questions={questions}
          current={current}
          currentQuizType={currentQuizType}
          showResult={null}
          status={status}
          userAnswers={userAnswers}
          handleContinue={handleContinue}
          resetQuiz={resetQuizWithRoute}
        />
      );
    }
    if (showStatus) {
      return renderStatusGrid();
    }
    return renderQuestion();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4">
      <div className="w-full max-w-3xl bg-white dark:bg-zinc-900 rounded-lg shadow-lg p-8 relative">
        {/* User name and logout button in top-right (only show if auth is enabled) */}
        {getUserDisplayName(user) && (
          <div
            className="absolute top-4 right-4 flex items-center gap-2 z-30"
            data-testid="auth-user"
          >
            <span className="text-xs text-gray-600 px-2 py-1 rounded">
              {getUserDisplayName(user)}
            </span>

            <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
            <button
              onClick={() => {
                trackAuth('logout', user?.isGuest ? 'guest' : 'google');
                logout();
              }}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
              title={t('common.signOutTitle')}
            >
              {t('common.signOut')}
            </button>
          </div>
        )}
        {renderContent()}
        <span
          className="absolute right-4 bottom-4 text-xs text-gray-500 hover:underline z-20"
          style={{ fontSize: '0.75rem' }}
        >
          v{packageJson.version}
        </span>
      </div>
    </div>
  );
}
