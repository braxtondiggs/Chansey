import { type Locator, type Page, test as base, expect } from '@playwright/test';

const TEST_USER = {
  email: 'e2e-test@chansey.local',
  password: 'Test123!@#',
  givenName: 'E2E',
  familyName: 'Test'
};

const API_URL = process.env['API_URL'] || 'http://localhost:3000';

export type RegisterFormData = {
  givenName: string;
  familyName: string;
  email: string;
  password: string;
  confirmPassword?: string;
};

/**
 * PrimeNG password fields wrap a native `<input>`. Use this helper to target
 * the actual input without repeating `.locator('input')` in every test.
 */
export const passwordInput = (page: Page, testId: string): Locator => page.getByTestId(testId).locator('input');

export const fillRegisterForm = async (page: Page, data: RegisterFormData): Promise<void> => {
  await page.getByTestId('register-given-name').fill(data.givenName);
  await page.getByTestId('register-family-name').fill(data.familyName);
  await page.getByTestId('register-email').fill(data.email);
  await passwordInput(page, 'register-password').fill(data.password);
  await passwordInput(page, 'register-confirm-password').fill(data.confirmPassword ?? data.password);
};

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
    };

    await use(login);
  },

  authenticatedPage: async ({ page, loginViaAPI }, use) => {
    await loginViaAPI();
    await use(page);
  }
});

export { expect };
