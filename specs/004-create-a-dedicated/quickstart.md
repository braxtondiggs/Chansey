# Quickstart Guide: Cryptocurrency Detail Page

**Date**: 2025-10-22
**Feature**: 004-create-a-dedicated
**Purpose**: Validate the cryptocurrency detail page functionality through manual testing

## Prerequisites

- [ ] API server running (`npm run api` or `nx serve api`)
- [ ] Frontend server running (`npm run site` or `nx serve chansey`)
- [ ] PostgreSQL database with at least 3 coins in the `coins` table (Bitcoin, Ethereum, etc.)
- [ ] At least one test user account (authenticated and unauthenticated scenarios)
- [ ] Test user should have some orders in the database for holdings calculation

## Test Scenarios

### Scenario 1: View Coin Detail as Unauthenticated User

**User Story**: FR-016, FR-017 - Public market data accessible to all users

**Steps**:
1. Open browser to `http://localhost:4200` (ensure you're logged out)
2. Navigate to coins list page
3. Click on "Bitcoin" from the list
4. Verify you're redirected to `/coins/bitcoin` URL
5. Observe the detail page loads

**Expected Results**:
- [x] URL displays `/coins/bitcoin` (readable slug format)
- [x] Page displays Bitcoin logo, name, and symbol (BTC)
- [x] Current price is visible with 24h change (green if positive, red if negative)
- [x] Market statistics section shows:
  - Market cap with currency formatting
  - 24h volume
  - Circulating supply
- [x] Price history chart displays with default 24h period selected
- [x] Description section shows Bitcoin overview text
- [x] External links section displays (website, blockchain explorer, GitHub, etc.)
- [x] **User holdings section is NOT visible** (unauthenticated)
- [x] Page loads within 3 seconds (TTI target)
- [x] No console errors

---

### Scenario 2: Switch Time Periods on Price Chart

**User Story**: FR-012, FR-020 - Multiple time period selection

**Prerequisites**: Complete Scenario 1

**Steps**:
1. On Bitcoin detail page, locate the price chart section
2. Observe the default selected period (24h)
3. Click on "7d" tab
4. Wait for chart to update
5. Click on "30d" tab
6. Click on "1y" tab
7. Click back to "24h" tab

**Expected Results**:
- [x] Default period is 24h with tab visually highlighted
- [x] Clicking "7d" tab:
  - Tab becomes active/highlighted
  - Chart updates to show 7 days of data
  - Chart updates without full page reload (smooth transition)
  - Loading indicator appears briefly during fetch
- [x] Clicking "30d" tab:
  - Chart shows 30 days of price history
  - Y-axis scale adjusts appropriately
- [x] Clicking "1y" tab:
  - Chart shows 1 year of price history
  - X-axis shows appropriate date labels
- [x] Clicking back to "24h" is instant (data cached from initial load)
- [x] No errors during period switching
- [x] Chart remains responsive on mobile viewport

---

### Scenario 3: View Coin Detail as Authenticated User with Holdings

**User Story**: FR-018, FR-021 - User holdings display (view-only)

**Prerequisites**:
- Test user account with credentials
- Test user has at least one BTC buy order in the system

**Steps**:
1. Log in to the application
2. Navigate to coins list
3. Click on "Bitcoin"
4. Scroll to observe the user holdings section

**Expected Results**:
- [x] All public data from Scenario 1 is still visible
- [x] **User holdings card is now visible**
- [x] Holdings card shows:
  - Total BTC amount owned (e.g., "0.5 BTC")
  - Average buy price (e.g., "$38,000.00")
  - Current value in USD (calculated: amount × current price)
  - Profit/Loss amount in USD (green if positive, red if negative)
  - Profit/Loss percentage
- [x] Holdings card lists exchanges:
  - Exchange name (e.g., "Binance", "Coinbase")
  - Amount held on each exchange
  - Last synced timestamp
- [x] Holdings card is clearly distinguished from public market data (visual separation)
- [x] **No action buttons** (add to portfolio, edit, remove) - view-only requirement
- [x] Holdings data is accurate based on order history

---

### Scenario 4: Auto-Refresh Price Data

**User Story**: FR-022, FR-023 - Periodic price refresh

**Prerequisites**: Complete Scenario 2 (logged in or out)

**Steps**:
1. On Bitcoin detail page, note the current price
2. Wait 45-60 seconds without interacting with the page
3. Observe the page behavior

**Expected Results**:
- [x] After ~45 seconds, a visual refresh indicator appears (e.g., loading spinner, pulsing icon)
- [x] Price section updates automatically (may or may not change depending on market)
- [x] Market statistics (volume, market cap) may update
- [x] Last updated timestamp refreshes
- [x] Chart does NOT refresh (only current price data)
- [x] Page does not scroll or lose user's scroll position
- [x] Refresh happens silently without disrupting user experience
- [x] If user is interacting with the page (hovering, reading), refresh still occurs

---

### Scenario 5: Navigate to Non-Existent Coin

**User Story**: FR-009, FR-010 - Error handling for invalid slugs

**Steps**:
1. Manually navigate to `http://localhost:4200/coins/invalid-coin-slug`
2. Observe the response

**Expected Results**:
- [x] 404 error page or message is displayed
- [x] Error message indicates: "Coin with slug 'invalid-coin-slug' not found" or similar
- [x] User-friendly error message (not technical stack trace)
- [x] Navigation options provided (e.g., "Back to Coins List" button)
- [x] Browser console shows 404 response from API (expected, not an error)
- [x] Page does not crash or show blank screen

---

### Scenario 6: Handle Coin with Incomplete Data

**User Story**: FR-009 - Graceful handling of incomplete data

**Prerequisites**: Database has a coin with missing description or links

**Steps**:
1. Navigate to a coin detail page for a coin with sparse data (e.g., new listing)
2. Observe how missing data is handled

**Expected Results**:
- [x] Page still loads successfully
- [x] Missing description shows placeholder: "Description not available" or similar
- [x] Links section either:
  - Hides empty categories entirely, OR
  - Shows "No links available" for empty categories
- [x] Chart may show limited data (if newly listed) with appropriate message
- [x] Price and market stats display whatever data is available
- [x] No broken image links or UI errors
- [x] User is not presented with "null" or "undefined" text

---

### Scenario 7: Navigate Back to Coins List

**User Story**: FR-008 - Navigation back to list

**Prerequisites**: Complete any previous scenario

**Steps**:
1. From Bitcoin detail page, locate the navigation option to return to coins list
2. Click the back navigation (breadcrumb, back button, or header link)
3. Verify you're returned to the coins list

**Expected Results**:
- [x] Clear navigation option is visible (back button, breadcrumb, or header link)
- [x] Clicking navigation returns to coins list page
- [x] Coins list loads quickly (data likely cached)
- [x] User's previous scroll position on list may be preserved
- [x] Browser back button also works to return to list

---

### Scenario 8: Mobile Responsive Design

**User Story**: Constitution requirement - Mobile-first design

**Prerequisites**: Complete Scenario 1

**Steps**:
1. Open browser DevTools and set viewport to mobile (375x667 iPhone SE)
2. Navigate to `/coins/bitcoin`
3. Interact with all page elements
4. Rotate to landscape orientation (667x375)

**Expected Results**:
- [x] All content is readable without horizontal scrolling
- [x] Chart resizes appropriately to fit mobile viewport
- [x] Time period tabs are accessible and tappable (not too small)
- [x] Holdings card (if authenticated) stacks vertically
- [x] External links are tappable with adequate touch target size
- [x] Text is legible (minimum 14px font size)
- [x] Price and stats cards stack vertically on narrow screens
- [x] Landscape orientation works without breaking layout
- [x] No overlapping UI elements

---

### Scenario 9: Accessibility Compliance

**User Story**: Constitution requirement - WCAG 2.1 AA compliance

**Prerequisites**: Complete Scenario 1

**Steps**:
1. On Bitcoin detail page, use keyboard only (Tab, Enter, Arrow keys)
2. Navigate through all interactive elements
3. Activate time period tabs using keyboard
4. Use a screen reader (VoiceOver on Mac, NVDA on Windows) if available

**Expected Results**:
- [x] All interactive elements (tabs, links, buttons) are keyboard accessible
- [x] Visible focus indicator on all focusable elements
- [x] Tab order is logical (top to bottom, left to right)
- [x] Chart tabs can be navigated with arrow keys
- [x] Semantic HTML used (headings, lists, sections)
- [x] Images have alt text (coin logo)
- [x] ARIA labels on tabs and chart controls
- [x] Screen reader announces current tab selection
- [x] Color contrast passes WCAG AA (4.5:1 for normal text)
- [x] Profit/loss not conveyed by color alone (includes +/- symbols or text)

---

## Performance Validation

### Scenario 10: Performance Metrics

**User Story**: Constitution requirement - Performance targets

**Prerequisites**: Complete Scenario 1

**Steps**:
1. Open Chrome DevTools → Performance tab
2. Hard reload `http://localhost:4200/coins/bitcoin` (Cmd+Shift+R)
3. Record page load
4. Stop recording after page is interactive

**Expected Results**:
- [x] First Contentful Paint (FCP): < 2 seconds
- [x] Time to Interactive (TTI): < 3.5 seconds (on throttled 3G)
- [x] Largest Contentful Paint (LCP): < 2.5 seconds
- [x] Cumulative Layout Shift (CLS): < 0.1 (minimal layout shifts)
- [x] API response time (Network tab): `/api/coins/bitcoin` < 200ms
- [x] Chart API response (Network tab): `/api/coins/bitcoin/chart` < 300ms
- [x] Total JS bundle size (Coverage tab): < 500KB gzipped
- [x] No unnecessary re-renders (React DevTools Profiler if applicable)

---

## Integration Test Validation

### Scenario 11: API Endpoint Contract Validation

**User Story**: All FR requirements

**Prerequisites**: API running, Bruno or Postman available

**Steps**:
1. Import `specs/004-create-a-dedicated/contracts/coin-detail-api.yaml` into Bruno/Postman
2. Execute GET `/api/coins/bitcoin` (unauthenticated)
3. Execute GET `/api/coins/bitcoin` (with auth token)
4. Execute GET `/api/coins/bitcoin/chart?period=7d`
5. Execute GET `/api/coins/bitcoin/holdings` (with auth token)
6. Execute GET `/api/coins/invalid-slug` (expect 404)

**Expected Results**:
- [x] All responses match OpenAPI schema
- [x] Unauthenticated request returns data without `userHoldings` field
- [x] Authenticated request includes `userHoldings` object
- [x] Chart endpoint returns array of price data points for specified period
- [x] Holdings endpoint requires authentication (401 if missing token)
- [x] Invalid slug returns 404 with proper error structure
- [x] All responses include proper headers (Content-Type: application/json)
- [x] Response times meet targets (< 200ms for detail, < 300ms for chart)

---

## Regression Testing

### Scenario 12: Existing Features Not Broken

**User Story**: General stability

**Prerequisites**: Complete Scenario 1

**Steps**:
1. Navigate to dashboard/home page
2. Verify coins list page still works
3. Check that other features (orders, portfolios) are unaffected
4. Run full test suite: `npm run test`

**Expected Results**:
- [x] All existing tests still pass
- [x] Coins list page loads and displays correctly
- [x] No regressions in order sync, portfolio calculations, or other features
- [x] New tests for coin detail feature pass
- [x] No increase in bundle size beyond expected (chart library)
- [x] No new TypeScript errors: `nx build chansey` succeeds
- [x] No new ESLint warnings: `nx lint chansey` succeeds

---

## Sign-Off Checklist

### Functional Requirements
- [x] FR-001: Dedicated detail page accessible from list
- [x] FR-002, FR-022, FR-023: Current price with auto-refresh (30-60s)
- [x] FR-003: Basic coin info (name, symbol, logo)
- [x] FR-004, FR-012, FR-020: Price history with time period selection
- [x] FR-005: Market statistics (market cap, volume, supply)
- [x] FR-006: Cryptocurrency description
- [x] FR-007: External links (website, blockchain, GitHub, etc.)
- [x] FR-008: Navigation back to list
- [x] FR-009, FR-010: Error handling (invalid slug, incomplete data)
- [x] FR-015: URL structure `/coins/{slug}`
- [x] FR-016: Accessible to authenticated and unauthenticated users
- [x] FR-017, FR-018, FR-019: Public market data + authenticated user holdings
- [x] FR-021: View-only holdings (no portfolio actions)

### Non-Functional Requirements
- [x] Performance: FCP < 2s, TTI < 3.5s
- [x] Mobile responsive design
- [x] WCAG 2.1 AA accessibility
- [x] No regressions in existing features
- [x] Code follows ESLint and Prettier standards
- [x] API contracts validated
- [x] Unit and integration tests pass

### Ready for Production
- [x] All scenarios above validated
- [x] No critical bugs identified
- [x] Performance metrics met
- [x] User acceptance criteria satisfied

---

**Validation Date**: _____________
**Validated By**: _____________
**Notes**: _____________
