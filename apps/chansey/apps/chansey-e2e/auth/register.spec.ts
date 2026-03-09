import { test, expect } from '../fixtures/auth.fixture';

test.describe('Register Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/register');
  });

  test.describe('Real API Integration', () => {
    test('should register a new user successfully', async ({ page }) => {
      const testEmail = `e2e-register-${Date.now()}@chansey.local`;

      await page.getByTestId('register-given-name').fill('New');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill(testEmail);
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByTestId('register-message')).toBeVisible();
      await expect(page.getByTestId('register-message')).toContainText('Registration successful');
    });

    test('should show error for duplicate email', async ({ page, testUser }) => {
      await page.getByTestId('register-given-name').fill('Duplicate');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill(testUser.email);
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByTestId('register-message')).toBeVisible();
    });
  });

  test.describe('Password Validation', () => {
    test('should reject password without uppercase', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('weakpass123!');
      await page.getByTestId('register-confirm-password').locator('input').fill('weakpass123!');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Password must contain at least one uppercase letter')).toBeVisible();
    });

    test('should reject password without lowercase', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('WEAKPASS123!');
      await page.getByTestId('register-confirm-password').locator('input').fill('WEAKPASS123!');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Password must contain at least one lowercase letter')).toBeVisible();
    });

    test('should reject password without number', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('WeakPass!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('WeakPass!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Password must contain at least one number')).toBeVisible();
    });

    test('should reject password without special character', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('WeakPass123');
      await page.getByTestId('register-confirm-password').locator('input').fill('WeakPass123');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Password must contain at least one special character')).toBeVisible();
    });

    test('should reject password shorter than 8 characters', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('Sh1!');
      await page.getByTestId('register-confirm-password').locator('input').fill('Sh1!');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    });

    test('should reject mismatched passwords', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('DifferentPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Passwords do not match')).toBeVisible();
    });
  });

  test.describe('Form Validation', () => {
    test('should show error for empty first name', async ({ page }) => {
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('First name is required')).toBeVisible();
    });

    test('should show error for empty last name', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-email').fill('test@example.com');
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Last name is required')).toBeVisible();
    });

    test('should show error for invalid email format', async ({ page }) => {
      await page.getByTestId('register-given-name').fill('Test');
      await page.getByTestId('register-family-name').fill('User');
      await page.getByTestId('register-email').fill('not-an-email');
      await page.getByTestId('register-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-confirm-password').locator('input').fill('ValidPass123!@#');
      await page.getByTestId('register-submit').click();

      await expect(page.getByText('Please enter a valid email')).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should redirect authenticated user away from register', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/register');

      await expect(authenticatedPage).toHaveURL(/\/app\/dashboard/);
    });

    test('should navigate to login page', async ({ page }) => {
      await page.getByRole('link', { name: 'Login' }).click();

      await expect(page).toHaveURL(/\/login/);
    });
  });
});
