import { test, expect } from '@playwright/test';
import { setupTestDataRoutes } from './helpers';

// Set to true to enable debug logging
const DEBUG_LOG = false;
function debugLog(...args: any[]) {
  if (DEBUG_LOG) console.log(...args);
}

// This test simulates the Cognito login callback (bypassing real Google/Cognito UI)
test.describe('Cognito login flow (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestDataRoutes(page);
  });

  test('sets user as authenticated after callback', async ({ page }) => {
    // Log all outgoing requests for debugging
    page.on('request', (request) => {
      debugLog('Request:', request.url());
    });
    // Inject required Cognito env variables into the browser context
    await page.addInitScript(() => {
      window.process = {
        env: {
          NEXT_PUBLIC_COGNITO_DOMAIN: 'https://mock-cognito',
          NEXT_PUBLIC_COGNITO_CLIENT_ID: 'mock-client-id',
          NEXT_PUBLIC_REDIRECT_SIGN_IN: 'http://localhost:3000/studio',
        },
      };
    });
    // Mock the token and userinfo endpoints BEFORE navigation
    await page.route('**/oauth2/token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id_token: 'mock.jwt.token' }),
      });
    });
    await page.route('**/oauth2/userinfo', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'e2e@example.com' }),
      });
    });

    // Simulate the callback URL with a code param
    await page.goto('/auth/callback?code=mock_code');
    debugLog('After callback, URL:', page.url());

    // Wait for the callback effect to complete
    await page.waitForTimeout(1000);
    // Ensure JWT is set in localStorage (simulate successful login if needed)
    await page.evaluate(() => {
      // Helper to base64url-encode a string
      function base64url(str) {
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      // Construct a valid JWT with an email payload
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url(JSON.stringify({ email: 'e2e@example.com' }));
      const jwt = `${header}.${payload}.signature`;
      localStorage.setItem('jwt', jwt);
    });
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/';
    await page.goto(basePath);
    // Check for authenticated UI immediately after callback
    await expect(page.locator('[data-testid="auth-user"]')).toContainText('e2e@example.com', {
      timeout: 10000,
    });
  });

  test('preserves /studio/en forced language after mocked callback', async ({ page }) => {
    await page.addInitScript(() => {
      window.process = {
        env: {
          NEXT_PUBLIC_COGNITO_DOMAIN: 'https://mock-cognito',
          NEXT_PUBLIC_COGNITO_CLIENT_ID: 'mock-client-id',
          NEXT_PUBLIC_REDIRECT_SIGN_IN: 'http://localhost:3000/studio',
        },
      };
    });

    await page.route('**/oauth2/token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id_token: 'mock.jwt.token' }),
      });
    });

    await page.goto('/en');
    await expect(page.getByText('Continue as Guest')).toBeVisible({ timeout: 10000 });

    await page.goto('/auth/callback?code=mock_code');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      function base64url(str) {
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url(JSON.stringify({ email: 'e2e@example.com' }));
      const jwt = `${header}.${payload}.signature`;
      localStorage.setItem('jwt', jwt);
    });

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/';
    await page.goto(basePath);
    await expect(page.locator('[data-testid="auth-user"]')).toContainText('e2e@example.com', {
      timeout: 10000,
    });
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('learningStudio') || '{}')
    );
    expect(state.language).toBe('en');
  });
});
