# Browse App Page

Navigate to any page in the Chansey app, handling login automatically.

**Usage:** `/browse <page> [--mobile|--tablet|--desktop] [--admin|--user]`

## Arguments

- `<page>`: Page name or path. Supports shortcuts:
  - **Auth pages** (no login needed):
    - `login` → `/login`
    - `register` → `/register`
    - `forgot-password` → `/forgot-password`
    - `reset-password` → `/auth/reset-password`
    - `verify-email` → `/auth/verify-email`
    - `otp` → `/auth/otp`
  - **App pages** (user login):
    - `dashboard` → `/app/dashboard`
    - `settings` → `/app/settings` (defaults to account tab)
    - `account` → `/app/settings?tab=account`
    - `trading` → `/app/settings?tab=trading`
    - `notification` → `/app/settings?tab=notification`
    - `security` → `/app/settings?tab=security`
    - `appearance` → `/app/settings?tab=appearance`
    - `transactions` → `/app/transactions`
    - `prices` → `/app/prices`
    - `watchlist` → `/app/watchlist`
    - `coins/<slug>` → `/app/coins/<slug>` (e.g., `coins/bitcoin`)
    - `spot-trading` → `/app/dashboard?trading=open` (opens Spot Trading drawer)
  - **Admin pages** (admin login):
    - `admin/algorithms` → `/admin/algorithms`
    - `admin/algorithms/<id>` → `/admin/algorithms/<id>` (algorithm detail)
    - `admin/coins` → `/admin/coins`
    - `admin/categories` → `/admin/categories`
    - `admin/exchanges` → `/admin/exchanges`
    - `admin/risks` → `/admin/risks`
    - `admin/trading-state` → `/admin/trading-state`
    - `admin/bull-board` → `/admin/bull-board`
    - `admin/backtest-monitoring` → `/admin/backtest-monitoring`
    - `admin/live-trade-monitoring` → `/admin/live-trade-monitoring`
  - Or any custom path starting with `/`
- `--mobile`: Use `playwright_resize` with device preset `iPhone 13`
- `--tablet`: Use `playwright_resize` with device preset `iPad Pro 11`
- `--desktop`: Use `playwright_resize` with width 1920, height 1080 (default viewport: 1280x720)
- `--admin`: Log in as admin user (default for `admin/*` pages)
- `--user`: Log in as regular user (default for all other pages)

## Credentials

Credentials are read from environment variables. **Never hardcode credentials.**

| User Type    | Email Env Var         | Password Env Var         |
| ------------ | --------------------- | ------------------------ |
| Admin        | `CHANSEY_ADMIN_EMAIL` | `CHANSEY_ADMIN_PASSWORD` |
| Regular User | `CHANSEY_USER_EMAIL`  | `CHANSEY_USER_PASSWORD`  |

These should be set in `.claude/settings.local.json` (gitignored):

```json
{
  "env": {
    "CHANSEY_ADMIN_EMAIL": "admin@example.com",
    "CHANSEY_ADMIN_PASSWORD": "...",
    "CHANSEY_USER_EMAIL": "user@example.com",
    "CHANSEY_USER_PASSWORD": "..."
  }
}
```

**Auto-detection:** If no `--admin` or `--user` flag is provided:

- Pages starting with `admin/` default to admin credentials
- All other pages default to regular user credentials

If the env vars are not set, ask the user for credentials before proceeding.

## Instructions

1. **Parse the argument** to determine the target URL, viewport size, and user type. Map shortcut names to full paths
   using the table above. Base URL is `http://localhost:4200`.

2. **Resolve credentials** based on user type (admin vs regular). Use Bash (`echo "$CHANSEY_USER_EMAIL"`, etc.) to read
   the actual env var values into your context **before** passing them to Playwright MCP tools. MCP tool parameters are
   plain strings — shell variable syntax like `${VAR}` will NOT be expanded. If the env vars are not set, ask the user.

3. **Open browser and navigate** to the target URL using `playwright_navigate`. If Playwright fails with
   `browserType.launchPersistentContext: Failed to launch the browser process` (Chrome is already open), first try using
   `playwright_browser_close` to close the existing Playwright browser session, then retry `playwright_navigate`. If
   that still fails, force-quit Chrome with `pkill -f "Google Chrome"` via Bash, wait a moment, then retry navigation.

4. **Check if login is needed**. Take a screenshot to check the page state:
   - **If on the login page**: Fill email/password with the resolved credentials, click submit, and wait for navigation.
   - **If already logged in but as the wrong user**: Use `playwright_evaluate` to call
     `fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })`, then navigate to the target URL again and
     log in with the correct credentials. You can detect the wrong user by checking if the page shows a different user's
     data than expected, or by fetching `/api/user` and comparing the email.
   - **If already logged in as the correct user**: No action needed, proceed.

5. **If a viewport size was requested**, use `playwright_resize` with the device preset (for `--mobile`/`--tablet`) or
   manual dimensions (for `--desktop`) **after** navigation and login. Do NOT rely on the width/height params in
   `playwright_navigate` — they don't properly emulate device characteristics like touch, user-agent, and pixel ratio.
   The `playwright_resize` tool handles all of this.

6. **Take screenshots** to capture the page state. Take an initial viewport screenshot. If the page has content below
   the fold that may be relevant (long pages, tables, forms), also scroll the **inner content container** and take
   additional screenshots. **Important:** The app uses `.layout-content-wrapper` as its scrollable container —
   `window.scrollTo()` and `fullPage: true` will NOT capture overflow content. Instead use `playwright_evaluate` to
   scroll the inner container:

   ```js
   const el = document.querySelector('.layout-content-wrapper');
   if (el) el.scrollTop = el.scrollHeight;
   ```

   Then take a viewport screenshot to see the bottom. For very long pages, take multiple screenshots at different scroll
   positions.

7. **Report what you see** — describe the page layout, visible components, data shown, and any issues. If the user asked
   about something specific, focus on that.

8. **Leave the browser open** so follow-up commands can continue interacting (e.g., "now click on the risk dropdown",
   "resize to mobile", "check console logs").

## Notes

- **Screenshots**: Always pass `downloadsDir: "/tmp/chansey-screenshots"` to `playwright_screenshot` so screenshots go
  to a temp directory instead of cluttering the user's Downloads folder.
- The dev server must be running (`npm start` or `npm run site` + `npm run api`)
- If login fails due to rate limiting, the API may need `NODE_ENV=test`
- For console log debugging, use the Chrome DevTools MCP tools separately
- You can chain interactions: after browsing, the user can ask you to click elements, fill forms, or resize without
  re-navigating
