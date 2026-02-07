import { type Page, test as base, expect } from '@playwright/test';

const TEST_USER = {
  email: 'e2e-test@chansey.local',
  password: 'Test123!@#',
  givenName: 'E2E',
  familyName: 'Test'
};

const API_URL = process.env['API_URL'] || 'http://localhost:3000';

type AuthFixtures = {
  testUser: typeof TEST_USER;
  loginViaAPI: () => Promise<void>;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  // eslint-disable-next-line no-empty-pattern
  testUser: async ({}, use) => {
    await use(TEST_USER);
  },

  loginViaAPI: async ({ context }, use) => {
    const login = async () => {
      const response = await context.request.post(`${API_URL}/api/auth/login`, {
        data: {
          email: TEST_USER.email,
          password: TEST_USER.password,
          remember: false
        }
      });

      if (!response.ok()) {
        const body = await response.text();
        throw new Error(`loginViaAPI failed: ${response.status()} ${response.statusText()} - ${body}`);
      }

      // Extract cookies from the API response and add them to the browser context
      const cookies = await context.cookies(API_URL);
      if (cookies.length > 0) {
        const frontendCookies = cookies
          .filter((c) => c.name === 'chansey_access' || c.name === 'chansey_refresh')
          .map((c) => ({
            ...c,
            domain: 'localhost',
            path: '/'
          }));
        if (frontendCookies.length > 0) {
          await context.addCookies(frontendCookies);
        }
      }
    };

    await use(login);
  },

  authenticatedPage: async ({ page, loginViaAPI }, use) => {
    await loginViaAPI();
    await use(page);
  }
});

export { expect };
