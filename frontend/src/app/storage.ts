import { AppLanguage, normalizeLanguage } from './i18n/config';

const LOCAL_STORAGE_KEY = 'learningStudio';
const ROUTE_LANGUAGE_OVERRIDE_STORAGE_KEY = 'learningStudioRouteLanguageOverride';
export const LEARNING_STUDIO_STATE_CHANGED_EVENT = 'learning-studio-state-changed';

type QuizStatusValue = 'correct' | 'fail' | 'pending';
type QuizStatus = { [key: number]: QuizStatusValue };
interface AreaState {
  currentQuestion: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  quizStatus: QuizStatus;
  selectedSections: string[];
  selectedQuestions: number[];
}

const VALID_QUIZ_STATUS_VALUES = new Set<QuizStatusValue>(['correct', 'fail', 'pending']);

function normalizeQuizStatus(input: unknown): QuizStatus | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const entries = Object.entries(input).filter(([key, value]) => {
    const index = Number(key);
    return (
      Number.isInteger(index) &&
      index >= 0 &&
      VALID_QUIZ_STATUS_VALUES.has(value as QuizStatusValue)
    );
  });
  return Object.fromEntries(entries) as QuizStatus;
}

function normalizeQuestionIndices(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return Array.from(
    new Set(
      input.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value) && value >= 0
      )
    )
  );
}

function normalizeSelectedSections(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return Array.from(
    new Set(input.filter((value): value is string => typeof value === 'string' && value.length > 0))
  );
}

function normalizeAreaState(input: unknown): Partial<AreaState> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as Partial<AreaState>;
  const normalized: Partial<AreaState> = {};
  if (typeof raw.shuffleQuestions === 'boolean') {
    normalized.shuffleQuestions = raw.shuffleQuestions;
  }
  if (typeof raw.shuffleAnswers === 'boolean') {
    normalized.shuffleAnswers = raw.shuffleAnswers;
  }

  const quizStatus = normalizeQuizStatus(raw.quizStatus);
  const selectedQuestions = normalizeQuestionIndices(raw.selectedQuestions);
  const hasProgress =
    Boolean(quizStatus && Object.keys(quizStatus).length > 0) ||
    Boolean(selectedQuestions && selectedQuestions.length > 0);

  // Empty containers plus a current-question marker are not resumable
  // progress. Drop only transient quiz fields and retain area preferences.
  if (hasProgress) {
    if (quizStatus && Object.keys(quizStatus).length > 0) {
      normalized.quizStatus = quizStatus;
    }
    if (selectedQuestions && selectedQuestions.length > 0) {
      normalized.selectedQuestions = selectedQuestions;
    }
    const selectedSections = normalizeSelectedSections(raw.selectedSections);
    if (selectedSections && selectedSections.length > 0) {
      normalized.selectedSections = selectedSections;
    }
    if (
      typeof raw.currentQuestion === 'number' &&
      Number.isInteger(raw.currentQuestion) &&
      raw.currentQuestion >= 0
    ) {
      normalized.currentQuestion = raw.currentQuestion;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

interface UserAreaConfig {
  allowedAreaShortNames: string[];
}

function normalizeAllowedAreaShortNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const filtered = input.filter((value): value is string => typeof value === 'string');
  return Array.from(new Set(filtered));
}

function normalizeUserAreaConfig(input: unknown): UserAreaConfig | undefined {
  if (Array.isArray(input)) {
    const normalized = normalizeAllowedAreaShortNames(input);
    return normalized.length > 0 ? { allowedAreaShortNames: normalized } : undefined;
  }

  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const allowed = normalizeAllowedAreaShortNames(
    (input as { allowedAreaShortNames?: unknown }).allowedAreaShortNames
  );
  return allowed.length > 0 ? { allowedAreaShortNames: allowed } : undefined;
}

function normalizeAreaConfigByUser(input: unknown): AppState['areaConfigByUser'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(input).map(
    ([userKey, config]) => [userKey, normalizeUserAreaConfig(config)] as const
  );

  const filtered = normalizedEntries.filter(([, config]) => Boolean(config));
  if (filtered.length === 0) {
    return undefined;
  }

  return Object.fromEntries(filtered);
}

export function sanitizeAppState(input: unknown): AppState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { areas: {} };
  }

  const obj = input as Partial<AppState>;
  const rawAreas =
    obj.areas && typeof obj.areas === 'object' && !Array.isArray(obj.areas) ? obj.areas : {};
  const normalizedAreas = Object.fromEntries(
    Object.entries(rawAreas)
      .map(([areaKey, areaState]) => [areaKey, normalizeAreaState(areaState)] as const)
      .filter((entry): entry is readonly [string, Partial<AreaState>] => Boolean(entry[1]))
  );
  const normalized: AppState = {
    areas: normalizedAreas,
  };

  if (typeof obj.language === 'string') {
    normalized.language = normalizeLanguage(obj.language);
  }
  if (typeof obj.currentArea === 'string' && obj.currentArea.length > 0) {
    normalized.currentArea = obj.currentArea;
  }
  const areaConfigByUser = normalizeAreaConfigByUser(obj.areaConfigByUser);
  if (areaConfigByUser) {
    normalized.areaConfigByUser = areaConfigByUser;
  }
  return normalized;
}
export interface AppState {
  language?: AppLanguage;
  currentArea?: string;
  areas: {
    [areaKey: string]: Partial<AreaState>;
  };
  areaConfigByUser?: {
    [userKey: string]: UserAreaConfig | undefined;
  };
}

export const storage = {
  getLanguage(): AppLanguage | undefined {
    return getStoredState().language;
  },

  setLanguage(language: AppLanguage | undefined) {
    const state = getStoredState();
    setStoredState({
      ...state,
      language: language ? normalizeLanguage(language) : undefined,
    });
  },

  getRouteLanguageOverride(): AppLanguage | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    try {
      const raw = window.localStorage.getItem(ROUTE_LANGUAGE_OVERRIDE_STORAGE_KEY);
      if (!raw) return undefined;
      return normalizeLanguage(raw);
    } catch (e) {
      console.error('Failed to read route language override from localStorage', e);
      return undefined;
    }
  },

  setRouteLanguageOverride(language: AppLanguage | undefined) {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      if (!language) {
        window.localStorage.removeItem(ROUTE_LANGUAGE_OVERRIDE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(ROUTE_LANGUAGE_OVERRIDE_STORAGE_KEY, normalizeLanguage(language));
    } catch (e) {
      console.error('Failed to write route language override to localStorage', e);
    }
  },

  consumeRouteLanguageOverride(): AppLanguage | undefined {
    const language = this.getRouteLanguageOverride();
    this.setRouteLanguageOverride(undefined);
    return language;
  },

  getCurrentArea(): string | undefined {
    return getStoredState().currentArea;
  },

  setCurrentArea(areaKey: string | undefined) {
    const state = getStoredState();
    setStoredState({ ...state, currentArea: areaKey });
  },

  setAreaCurrentQuestion(areaKey: string, questionIndex?: number) {
    updateAreaState(areaKey, { currentQuestion: questionIndex });
  },

  getAreaCurrentQuestion(areaKey: string): number | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.currentQuestion;
  },

  setAreaShuffleQuestions(areaKey: string, shuffle: boolean) {
    updateAreaState(areaKey, { shuffleQuestions: shuffle });
  },

  getAreaShuffleQuestions(areaKey: string): boolean | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.shuffleQuestions;
  },

  setAreaShuffleAnswers(areaKey: string, shuffle: boolean) {
    updateAreaState(areaKey, { shuffleAnswers: shuffle });
  },

  getAreaShuffleAnswers(areaKey: string): boolean | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.shuffleAnswers;
  },

  setAreaQuizStatus(areaKey: string, status?: QuizStatus) {
    updateAreaState(areaKey, { quizStatus: status });
  },

  getAreaQuizStatus(areaKey: string): QuizStatus | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.quizStatus;
  },

  setAreaSelectedSections(areaKey: string, sections?: string[]) {
    updateAreaState(areaKey, { selectedSections: sections });
  },

  getAreaSelectedSections(areaKey: string): string[] | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.selectedSections;
  },

  setAreaSelectedQuestions(areaKey: string, questions?: number[]) {
    updateAreaState(areaKey, { selectedQuestions: questions });
  },

  getAreaSelectedQuestions(areaKey: string): number[] | undefined {
    const areaState = getAreaState(areaKey);
    return areaState.selectedQuestions;
  },

  replaceAreaQuizProgress(
    areaKey: string,
    progress: Pick<
      Partial<AreaState>,
      'currentQuestion' | 'quizStatus' | 'selectedQuestions' | 'selectedSections'
    >
  ) {
    const state = getStoredState();
    const existingArea = state.areas[areaKey] || {};
    const preferences = { ...existingArea };
    delete preferences.currentQuestion;
    delete preferences.quizStatus;
    delete preferences.selectedQuestions;
    delete preferences.selectedSections;
    setStoredState({
      ...state,
      areas: {
        ...state.areas,
        [areaKey]: {
          ...preferences,
          ...progress,
        },
      },
    });
  },

  setUserAllowedAreas(userKey: string, allowedAreaShortNames: string[]) {
    const state = getStoredState();
    const existingConfigByUser = state.areaConfigByUser || {};
    const deduped = Array.from(new Set(allowedAreaShortNames));
    setStoredState({
      ...state,
      areaConfigByUser: {
        ...existingConfigByUser,
        [userKey]: {
          allowedAreaShortNames: deduped,
        },
      },
    });
  },

  getUserAllowedAreas(userKey: string): string[] | undefined {
    const state = getStoredState();
    return state.areaConfigByUser?.[userKey]?.allowedAreaShortNames;
  },
  getStateSnapshot: getStoredState,
  replaceState: setStoredState,
  clearState,
  clearAreaState,
};

function getStoredState(): AppState {
  if (typeof window === 'undefined') {
    return { areas: {} };
  }
  try {
    const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      const normalized = sanitizeAppState(parsed);
      const normalizedJson = JSON.stringify(normalized);
      if (normalizedJson !== JSON.stringify(parsed)) {
        localStorage.setItem(LOCAL_STORAGE_KEY, normalizedJson);
      }
      return normalized;
    }
  } catch (e) {
    console.error('Failed to parse state from localStorage', e);
  }
  return { areas: {} };
}

function setStoredState(state: AppState) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const normalizedState = sanitizeAppState(state);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizedState));
    dispatchStateChanged(normalizedState);
  } catch (e) {
    console.error('Failed to save state to localStorage', e);
  }
}

function getAreaState(areaKey: string): Partial<AreaState> {
  const state = getStoredState();
  return state.areas[areaKey] || {};
}

function updateAreaState(areaKey: string, newAreaState: Partial<AreaState>) {
  const state = getStoredState();
  const updatedState = {
    ...state,
    areas: {
      ...state.areas,
      [areaKey]: {
        ...(state.areas[areaKey] || {}),
        ...newAreaState,
      },
    },
  };
  setStoredState(updatedState);
}

function clearState() {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  localStorage.removeItem(ROUTE_LANGUAGE_OVERRIDE_STORAGE_KEY);
  dispatchStateChanged({ areas: {} });
}

function clearAreaState(areaKey: string) {
  const state = getStoredState();
  if (state.areas[areaKey]) {
    delete state.areas[areaKey];
    setStoredState(state);
  }
}

function dispatchStateChanged(state: AppState) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(LEARNING_STUDIO_STATE_CHANGED_EVENT, {
      detail: state,
    })
  );
}
