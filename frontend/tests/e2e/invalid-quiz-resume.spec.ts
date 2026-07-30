import { expect, test } from '@playwright/test';
import { setupFreshTestAuthenticated, setupTestDataRoutes } from './helpers';

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');

function createMockJwt(email: string) {
  const encode = (input: string) =>
    Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encode(
    JSON.stringify({ email })
  )}.signature`;
}

test('recovers when persisted quiz progress contains only empty containers', async ({ page }) => {
  await setupFreshTestAuthenticated(page);

  await page.evaluate(() => {
    const existing = JSON.parse(localStorage.getItem('learningStudio') || '{"areas":{}}');
    localStorage.setItem(
      'learningStudio',
      JSON.stringify({
        ...existing,
        currentArea: 'log1',
        areas: {
          ...existing.areas,
          log1: {
            currentQuestion: 0,
            quizStatus: {},
            selectedQuestions: [],
          },
        },
      })
    );
  });

  await page.goto(`${basePath}/quiz`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('selection-menu')).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('loading-spinner')).toBeHidden();

  const repairedProgress = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('learningStudio') || '{"areas":{}}');
    const area = state.areas?.log1 ?? {};
    return {
      hasCurrentQuestion: Object.hasOwn(area, 'currentQuestion'),
      hasQuizStatus: Object.hasOwn(area, 'quizStatus'),
      hasSelectedQuestions: Object.hasOwn(area, 'selectedQuestions'),
    };
  });
  expect(repairedProgress).toEqual({
    hasCurrentQuestion: false,
    hasQuizStatus: false,
    hasSelectedQuestions: false,
  });
});

test('sanitizes invalid authenticated bootstrap state before one LOG1 load', async ({ page }) => {
  const email = 'invalid-remote-resume@example.com';
  const jwt = createMockJwt(email);
  let learningStateGets = 0;
  let log1QuestionGets = 0;

  await setupTestDataRoutes(page);
  page.on('request', (request) => {
    if (request.url().includes('questions-logica1.json')) {
      log1QuestionGets += 1;
    }
  });
  await page.route('**/learning-state*', async (route) => {
    if (route.request().method() === 'GET') {
      learningStateGets += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: 'global',
          updatedAt: '2026-07-30T10:00:00.000Z',
          state: {
            language: 'es',
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
            areaConfigByUser: {
              [`${email}::lang:es`]: {
                allowedAreaShortNames: ['log1', 'ipc'],
              },
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.addInitScript((token) => {
    localStorage.clear();
    localStorage.setItem('jwt', token);
  }, jwt);

  await page.goto(`${basePath}/areas`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = JSON.parse(localStorage.getItem('learningStudio') || '{"areas":{}}');
          return {
            log1: state.areas?.log1,
            log2: state.areas?.log2,
          };
        }),
      { timeout: 10000 }
    )
    .toEqual({
      log1: {
        shuffleQuestions: false,
      },
      log2: {
        currentQuestion: 1,
        quizStatus: { 0: 'correct', 1: 'pending' },
        selectedQuestions: [0, 1],
      },
    });

  const acceptAreaConfiguration = page.getByTestId('area-config-accept');
  if (await acceptAreaConfiguration.isVisible().catch(() => false)) {
    await acceptAreaConfiguration.click();
  }
  await expect(page.getByTestId('area-log1')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('area-log1').click();
  await expect(page.getByTestId('selection-menu')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('loading-spinner')).toBeHidden();
  expect(learningStateGets).toBe(1);
  expect(log1QuestionGets).toBe(1);
});
