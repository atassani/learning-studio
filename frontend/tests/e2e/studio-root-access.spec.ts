import { test, expect, type Page } from '@playwright/test';
import { setupTestDataRoutes } from './helpers';

const getStudioUrls = (baseURL?: string) => {
  const fallbackBase = 'http://localhost:3000/studio/';
  const resolved = new URL(baseURL ?? fallbackBase);
  const basePath = resolved.pathname.replace(/\/$/, '');
  return {
    rootNoSlash: `${resolved.origin}${basePath}`,
    rootIndex: `${resolved.origin}${basePath}/index.html`,
    quiz: `${resolved.origin}${basePath}/quiz`,
    quizSections: `${resolved.origin}${basePath}/quiz/sections`,
    quizQuestions: `${resolved.origin}${basePath}/quiz/questions`,
    quizStatus: `${resolved.origin}${basePath}/quiz/status`,
  };
};

const ensureGuestLoginIfPresent = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  const guestLogin = page.getByTestId('guest-login-btn');
  if (await guestLogin.count()) {
    await guestLogin.click();
  }
};

const expectRouteStatusWithRetry = async (
  page: Page,
  url: string,
  expectedStatus: number,
  attempts = 3
) => {
  let lastStatus: number | undefined;
  for (let i = 0; i < attempts; i++) {
    const response = await page.request.get(url, { timeout: 20000 });
    lastStatus = response.status();
    if (lastStatus === expectedStatus) {
      return;
    }
    await page.waitForTimeout(500);
  }
  expect(lastStatus).toBe(expectedStatus);
};

test.describe('Studio root access', () => {
  test('accessing /studio should work without trailing slash', async ({ page }) => {
    await setupTestDataRoutes(page);

    // Go to the root /studio path (without trailing slash)
    const { rootNoSlash } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    await expectRouteStatusWithRetry(page, rootNoSlash, 200);
    const response = await page.goto(rootNoSlash);
    expect(response?.status()).toBe(200);

    await ensureGuestLoginIfPresent(page);

    // Should load the actual app content
    await expect(page.getByText('¿Qué quieres estudiar?')).toBeVisible({ timeout: 10000 });
  });

  test('accessing /studio/index.html should return 404', async ({ page }) => {
    // We no longer generate an index.html route in Next export.
    const { rootIndex } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    const response = await page.goto(rootIndex);

    expect(response?.status()).toBe(404);
  });

  test('accessing /studio/quiz should return 200', async ({ page }) => {
    await setupTestDataRoutes(page);
    const { quiz } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    await expectRouteStatusWithRetry(page, quiz, 200);
  });

  test('accessing /studio/quiz/sections should return 200', async ({ page }) => {
    await setupTestDataRoutes(page);
    const { quizSections } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    await expectRouteStatusWithRetry(page, quizSections, 200);
  });

  test('accessing /studio/quiz/questions should return 200', async ({ page }) => {
    await setupTestDataRoutes(page);
    const { quizQuestions } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    await expectRouteStatusWithRetry(page, quizQuestions, 200);
  });

  test('accessing /studio/quiz/status should return 200', async ({ page }) => {
    await setupTestDataRoutes(page);
    const { quizStatus } = getStudioUrls(test.info().project.use.baseURL as string | undefined);
    await expectRouteStatusWithRetry(page, quizStatus, 200);
  });
});
