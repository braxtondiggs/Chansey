import { test, expect } from '../fixtures/auth.fixture';

test.describe('Logout Flow', () => {
  test.describe('Real API Integration', () => {
    test('should logout and redirect to login', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/app/dashboard');
      await authenticatedPage.waitForURL('**/app/dashboard');

      await authenticatedPage.getByTestId('profile-menu-trigger').click();
      await authenticatedPage.getByTestId('profile-logout').click();

      await authenticatedPage.waitForURL('**/login');
      await expect(authenticatedPage).toHaveURL(/\/login/);

      const cookies = await authenticatedPage.context().cookies();
      const accessCookie = cookies.find((c) => c.name === 'chansey_access');
      expect(accessCookie?.value || '').toBeFalsy();
    });

    test('should prevent access to protected routes after logout', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/app/dashboard');
      await authenticatedPage.waitForURL('**/app/dashboard');

      await authenticatedPage.getByTestId('profile-menu-trigger').click();
      await authenticatedPage.getByTestId('profile-logout').click();

      await authenticatedPage.waitForURL('**/login');

      // Try accessing a protected route
      await authenticatedPage.goto('/app/dashboard');
      await expect(authenticatedPage).toHaveURL(/\/login/);
    });
  });

  test.describe('Mocked Edge Cases', () => {
    test('should stay on page when logout API fails', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/app/dashboard');
      await authenticatedPage.waitForURL('**/app/dashboard');

      await authenticatedPage.route('**/api/auth/logout', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal server error' })
        })
      );

      await authenticatedPage.getByTestId('profile-menu-trigger').click();
      await authenticatedPage.getByTestId('profile-logout').click();

      // Wait for the failed mutation to settle before asserting
      await authenticatedPage.waitForTimeout(1000);

      // When logout API fails, the user stays on the current page
      await expect(authenticatedPage).toHaveURL(/\/app\/dashboard/);
    });
  });
});
