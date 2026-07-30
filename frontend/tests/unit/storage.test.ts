import { storage } from '../../src/app/storage';

describe('localStorage abstraction', () => {
  it('stores and retrieves preferred language', () => {
    storage.setLanguage('ca');
    expect(storage.getLanguage()).toBe('ca');
    expect(JSON.parse(localStorage.getItem('learningStudio') || '{}').language).toBe('ca');
  });

  it('normalizes stored preferred language when reading state', () => {
    localStorage.setItem('learningStudio', JSON.stringify({ areas: {}, language: 'EN' }));
    expect(storage.getLanguage()).toBe('en');
  });

  it('stores and consumes route language override', () => {
    storage.setRouteLanguageOverride('en');
    expect(storage.getRouteLanguageOverride()).toBe('en');
    expect(storage.consumeRouteLanguageOverride()).toBe('en');
    expect(storage.getRouteLanguageOverride()).toBeUndefined();
  });

  it('write currentArea using storage module is read directly from localStorage', () => {
    const area = 'Area 42';
    storage.setCurrentArea(area);
    const storedState = localStorage.getItem('learningStudio');
    expect(storedState).toContain(`"currentArea":"${area}"`);
    expect(JSON.parse(storedState || '{}').currentArea).toBe(area);
  });

  it('write currentArea directly to localStorage is read by storage module', () => {
    const stateToStore = { currentArea: 'Area 51', areas: {} };
    localStorage.setItem('learningStudio', JSON.stringify(stateToStore));
    const currentArea = storage.getCurrentArea();
    expect(currentArea).toBe('Area 51');
  });

  it('writes area currentQuestion when resumable progress exists', () => {
    const theArea = 'the-area';
    const theCurrentQuestion = 3;
    storage.setAreaQuizStatus(theArea, { 3: 'pending' });
    storage.setAreaCurrentQuestion(theArea, theCurrentQuestion);
    const storedState = localStorage.getItem('learningStudio');
    const areasFromState = JSON.parse(storedState || '{}').areas;
    const theAreaFromState = areasFromState ? areasFromState[theArea] : null;
    expect(theAreaFromState.currentQuestion).toBe(theCurrentQuestion);
  });

  it('reads area currentQuestion from localStorage when resumable progress exists', () => {
    const stateToStore = {
      currentArea: 'the-area',
      areas: { ['the-area']: { currentQuestion: 3, quizStatus: { 3: 'pending' } } },
    };
    localStorage.setItem('learningStudio', JSON.stringify(stateToStore));
    const currentQuestion = storage.getAreaCurrentQuestion('the-area');
    expect(currentQuestion).toBe(3);
  });

  it('write area shuffleQuestions using storage module is read directly from localStorage', () => {
    const theArea = 'the-area';
    const theShuffleQuestions = true;
    storage.setAreaShuffleQuestions(theArea, theShuffleQuestions);
    const storedState = localStorage.getItem('learningStudio');
    const areasFromState = JSON.parse(storedState || '{}').areas;
    const theAreaFromState = areasFromState ? areasFromState[theArea] : null;
    expect(theAreaFromState.shuffleQuestions).toBe(theShuffleQuestions);
  });

  it('write area shuffleQuestions directly to localStorage is read by storage module', () => {
    const stateToStore = {
      currentArea: 'the-area',
      areas: { ['the-area']: { shuffleQuestions: true } },
    };
    localStorage.setItem('learningStudio', JSON.stringify(stateToStore));
    const shuffleQuestions = storage.getAreaShuffleQuestions('the-area');
    expect(shuffleQuestions).toBe(true);
  });

  it('write area quizStatus using storage module is read directly from localStorage', () => {
    const theArea = 'the-area';
    const theQuizStatus = { 0: 'correct', 1: 'fail' } as const;
    storage.setAreaQuizStatus(theArea, theQuizStatus);
    const storedState = localStorage.getItem('learningStudio');
    const areasFromState = JSON.parse(storedState || '{}').areas;
    const theAreaFromState = areasFromState ? areasFromState[theArea] : null;
    expect(theAreaFromState.quizStatus).toEqual(theQuizStatus);
  });

  it('write area quizStatus directly to localStorage is read by storage module', () => {
    const theQuizStatus = { 0: 'correct', 1: 'fail' } as const;
    const stateToStore = {
      currentArea: 'the-area',
      areas: { ['the-area']: { quizStatus: theQuizStatus } },
    };
    localStorage.setItem('learningStudio', JSON.stringify(stateToStore));
    const quizStatus = storage.getAreaQuizStatus('the-area');
    expect(quizStatus).toEqual(theQuizStatus);
  });

  it('stores and retrieves user allowed areas preserving order', () => {
    storage.setUserAllowedAreas('user-123', ['ipc', 'fdl', 'log1']);
    expect(storage.getUserAllowedAreas('user-123')).toEqual(['ipc', 'fdl', 'log1']);
  });

  it('deduplicates repeated user allowed areas before storing', () => {
    storage.setUserAllowedAreas('user-123', ['ipc', 'ipc', 'fdl']);
    expect(storage.getUserAllowedAreas('user-123')).toEqual(['ipc', 'fdl']);
  });

  it('sanitizes invalid area progress at ingestion while preserving preferences and other areas', () => {
    localStorage.setItem(
      'learningStudio',
      JSON.stringify({
        language: 'en',
        currentArea: 'log1',
        areas: {
          log1: {
            currentQuestion: 0,
            quizStatus: {},
            selectedQuestions: [],
            selectedSections: [],
            shuffleQuestions: false,
            shuffleAnswers: true,
          },
          log2: {
            currentQuestion: 1,
            quizStatus: { 0: 'correct', 1: 'pending' },
            selectedQuestions: [0, 1],
            shuffleQuestions: true,
          },
        },
      })
    );

    expect(storage.getStateSnapshot()).toEqual({
      language: 'en',
      currentArea: 'log1',
      areas: {
        log1: {
          shuffleQuestions: false,
          shuffleAnswers: true,
        },
        log2: {
          currentQuestion: 1,
          quizStatus: { 0: 'correct', 1: 'pending' },
          selectedQuestions: [0, 1],
          shuffleQuestions: true,
        },
      },
    });
    expect(JSON.parse(localStorage.getItem('learningStudio') || '{}').areas.log1).toEqual({
      shuffleQuestions: false,
      shuffleAnswers: true,
    });
  });
});
