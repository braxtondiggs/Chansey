import { test, expect } from '../fixtures/auth.fixture';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/login');
  });

  test.describe('Real API Integration', () => {
    test('should login with valid credentials and redirect to dashboard', async ({ page, testUser }) => {
      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-submit').click();

      await page.waitForURL('**/app/dashboard');
      await expect(page).toHaveURL(/\/app\/dashboard/);

      const accessCookie = await page.context().cookies();
      expect(accessCookie.some((c) => c.name === 'chansey_access')).toBeTruthy();
      expect(accessCookie.some((c) => c.name === 'chansey_refresh')).toBeTruthy();
    });

    test('should login with remember me checked', async ({ page, testUser }) => {
      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-remember').locator('input').check();
      await page.getByTestId('login-submit').click();

      await page.waitForURL('**/app/dashboard');

      const cookies = await page.context().cookies();
      expect(cookies.some((c) => c.name === 'chansey_refresh')).toBeTruthy();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.getByTestId('login-email').fill('nonexistent@example.com');
      await page.getByTestId('login-password').locator('input').fill('WrongPass123!');
      await page.getByTestId('login-submit').click();

      await expect(page.getByTestId('login-message')).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });

    test('should show error for wrong password', async ({ page, testUser }) => {
      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill('WrongPassword123!');
      await page.getByTestId('login-submit').click();

      await expect(page.getByTestId('login-message')).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Client-Side Validation', () => {
    test('should show error for empty email', async ({ page }) => {
      await page.getByTestId('login-password').locator('input').fill('Password123!');
      await page.getByTestId('login-submit').click();

      await expect(page.getByText('Email is required')).toBeVisible();
    });

    test('should show error for invalid email format', async ({ page }) => {
      await page.getByTestId('login-email').fill('not-an-email');
      await page.getByTestId('login-password').locator('input').fill('Password123!');
      await page.getByTestId('login-submit').click();

      await expect(page.getByText('Please enter a valid email')).toBeVisible();
    });

    test('should show error for empty password', async ({ page }) => {
      await page.getByTestId('login-email').fill('test@example.com');
      await page.getByTestId('login-submit').click();

      await expect(page.getByText('Password is required')).toBeVisible();
    });
  });

  test.describe('Mocked Edge Cases', () => {
    test('should show resend verification for unverified email', async ({ page, testUser }) => {
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 403,
            code: 'AUTH.EMAIL_NOT_VERIFIED',
            message: 'Please verify your email before logging in',
            path: '/api/auth/login'
          })
        })
      );

      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-submit').click();

      await expect(page.getByTestId('login-message')).toBeVisible();
      await expect(page.getByTestId('login-resend-verification')).toBeVisible();
    });

    test('should show lockout message for locked account', async ({ page, testUser }) => {
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 429,
            code: 'AUTH.ACCOUNT_LOCKED',
            message: 'Account locked due to too many failed login attempts. Please try again later.',
            path: '/api/auth/login'
          })
        })
      );

      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-submit').click();

      await expect(page.getByTestId('login-message')).toBeVisible();
      await expect(page.getByTestId('login-message')).toContainText('Account locked');
    });

    test('should handle OTP required flow', async ({ page, testUser }) => {
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            should_show_email_otp_screen: true,
            message: 'Two-factor authentication required',
            user: null,
            access_token: null
          })
        })
      );

      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-submit').click();

      // OTP required response redirects to the OTP verification page
      await expect(page).toHaveURL(/\/auth\/otp/);
    });

    test('should handle network error gracefully', async ({ page, testUser }) => {
      await page.route('**/api/auth/login', (route) => route.abort());

      await page.getByTestId('login-email').fill(testUser.email);
      await page.getByTestId('login-password').locator('input').fill(testUser.password);
      await page.getByTestId('login-submit').click();

      await expect(page.getByTestId('login-message')).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should redirect authenticated user away from login', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/login');

      await expect(authenticatedPage).toHaveURL(/\/app\/dashboard/);
    });

    test('should navigate to register page', async ({ page }) => {
      await page.getByText('Create an Account').click();

      await expect(page).toHaveURL(/\/register/);
    });

    test('should navigate to forgot password page', async ({ page }) => {
      await page.getByText('Forgot password?').click();

      await expect(page).toHaveURL(/\/forgot-password/);
    });
  });
});
