# Tasks: Cryptocurrency Detail Page

**Feature**: 004-create-a-dedicated **Input**: Design documents from `/specs/004-create-a-dedicated/` **Branch**:
`004-create-a-dedicated`

## Execution Summary

This task list implements the cryptocurrency detail page feature following TDD principles. Tasks are ordered by
dependencies with parallel execution markers [P] where appropriate.

**Tech Stack**:

- Backend: NestJS 10, TypeORM, PostgreSQL, Redis
- Frontend: Angular 20 standalone components, PrimeNG, TanStack Query
- Testing: Jest (unit/integration), contract tests for CoinGecko API
- Architecture: Nx monorepo, brownfield (extend existing coin module)

**Key Constraints**:

- BROWNFIELD: Extend existing coin module, do NOT scaffold new modules
- TDD: Write failing tests before implementation
- Performance: API <150ms, Frontend FCP <2s, TTI <3.5s
- Accessibility: WCAG 2.1 AA compliance

---

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- All file paths are absolute from repository root

---

## Phase 3.1: Setup & Database

### Database Migration

- [x] **T001** Create TypeORM migration for Coin entity extensions in `apps/api/src/migrations/`
  - Add `slug` column (varchar 100, unique, not null)
  - Add `description` column (text, nullable)
  - Add `links` column (jsonb, nullable)
  - Add `metadataLastUpdated` column (timestamp, nullable)
  - Create unique index `idx_coin_slug` on `slug`
  - Backfill `slug` from `coinGeckoId` or generate from `name`
  - **Validation**: Run migration, verify all coins have unique slugs

### Shared Types

- [x] **T002 [P]** Add DTOs to `libs/api-interfaces/src/lib/coin.interface.ts`
  - `CoinDetailResponseDto` with all fields from data-model.md
  - `CoinLinksDto` for external links structure
  - `MarketChartResponseDto` with period-based price data
  - `PriceDataPoint` interface
  - `UserHoldingsDto` with profit/loss calculations
  - `ExchangeHoldingDto` for per-exchange breakdown
  - **Validation**: Run `nx build api-interfaces`, no TypeScript errors

---

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation begins**

### Contract Tests (External API)

- [x] **T003 [P]** CoinGecko API contract test in `tests/contract/coingecko-api.contract.spec.ts`
  - Test `/coins/{id}` endpoint response structure
  - Validate presence of: name, symbol, market_data, description, links
  - Test `/coins/{id}/market_chart?days=X` response structure
  - Mock CoinGecko responses for stable tests
  - **Expected**: Tests FAIL (no implementation yet)
  - **Validation**: `npm run test -- coingecko-api.contract.spec.ts` shows failures

### Backend Integration Tests

- [x] **T004 [P]** Test GET `/api/coins/:slug` (unauthenticated) in `apps/api/src/coin/coin.controller.spec.ts`
  - Test valid slug returns 200 with complete coin data
  - Test invalid slug returns 404 with error message
  - Test response includes public data (price, stats, description, links)
  - Test response does NOT include userHoldings for unauthenticated
  - **Expected**: Tests FAIL (endpoint not implemented)
  - **Validation**: Run integration test, verify failures

- [x] **T005 [P]** Test GET `/api/coins/:slug` (authenticated) in `apps/api/src/coin/coin.controller.spec.ts`
  - Test authenticated request includes userHoldings
  - Test userHoldings calculation (total, average price, profit/loss)
  - Test per-exchange breakdown in holdings
  - **Expected**: Tests FAIL (holdings calculation not implemented)
  - **Validation**: Run integration test, verify failures

- [x] **T006 [P]** Test GET `/api/coins/:slug/chart?period=X` in `apps/api/src/coin/coin.controller.spec.ts`
  - Test each period (24h, 7d, 30d, 1y) returns correct data structure
  - Test price data points array with timestamps
  - Test invalid period returns 400 error
  - Test invalid slug returns 404
  - **Expected**: Tests FAIL (chart endpoint not implemented)
  - **Validation**: Run integration test, verify failures

- [x] **T007 [P]** Test GET `/api/coins/:slug/holdings` (authenticated) in `apps/api/src/coin/coin.controller.spec.ts`
  - Test returns user holdings for valid coin
  - Test returns 404 when user has no holdings
  - Test returns 401 when not authenticated
  - Test holdings calculation accuracy
  - **Expected**: Tests FAIL (holdings endpoint not implemented)
  - **Validation**: Run integration test, verify failures

### Backend Unit Tests (Services)

- [ ] **T008 [P]** Test slug generation utility in `apps/api/src/coin/coin.service.spec.ts`
  - Test generates valid slug from coin name (lowercase, hyphenated)
  - Test handles special characters correctly
  - Test ensures uniqueness check
  - Test handles edge cases (empty, very long names)
  - **Expected**: Tests FAIL (utility not implemented)
  - **Validation**: Run unit test, verify failures

- [ ] **T009 [P]** Test CoinGecko data fetching in `apps/api/src/coin/coin.service.spec.ts`
  - Test fetches coin detail from CoinGecko
  - Test fetches market chart data
  - Test handles API rate limiting (429 response)
  - Test handles API errors gracefully
  - Test Redis caching (5min TTL)
  - **Expected**: Tests FAIL (CoinGecko integration not implemented)
  - **Validation**: Run unit test, verify failures

- [ ] **T010 [P]** Test holdings calculation in `apps/api/src/order/order.service.spec.ts`
  - Test aggregates orders across multiple exchanges
  - Test calculates weighted average buy price
  - Test handles sells reducing total amount
  - Test handles no orders (zero holdings)
  - Test per-exchange breakdown
  - **Expected**: Tests FAIL (holdings method not implemented)
  - **Validation**: Run unit test, verify failures

### Frontend Component Tests

- [ ] **T011 [P]** Test CoinDetailComponent in `apps/chansey/src/app/coins/coin-detail/coin-detail.component.spec.ts`
  - Test renders coin info (name, symbol, logo, price)
  - Test displays market stats (market cap, volume, supply)
  - Test shows description section
  - Test shows external links section
  - Test authenticated user sees holdings card
  - Test unauthenticated user does NOT see holdings card
  - Test loading state shows skeleton screens
  - Test error state shows error message
  - **Expected**: Tests FAIL (component not created)
  - **Validation**: Run unit test, verify failures

- [ ] **T012 [P]** Test PriceChartComponent in
      `apps/chansey/src/app/coins/components/price-chart/price-chart.component.spec.ts`
  - Test renders Chart.js line chart
  - Test default period is 24h
  - Test period selector tabs (24h, 7d, 30d, 1y)
  - Test switching periods updates chart data
  - Test handles empty/missing data gracefully
  - Test responsive on mobile viewport
  - **Expected**: Tests FAIL (component not created)
  - **Validation**: Run unit test, verify failures

- [ ] **T013 [P]** Test TanStack Query hooks in `apps/chansey/src/app/coins/services/coin-detail.queries.spec.ts`
  - Test useCoinDetailQuery fetches detail data
  - Test useCoinPriceQuery auto-refetches every 45s
  - Test useCoinHistoryQuery keyed by period
  - Test useUserHoldingsQuery only runs when authenticated
  - Test error handling and retry logic
  - **Expected**: Tests FAIL (query hooks not implemented)
  - **Validation**: Run unit test, verify failures

---

## Phase 3.3: Core Implementation (ONLY after tests are failing)

**Prerequisites**: All tests in Phase 3.2 must be written and failing

### Backend - Database & Entity

- [ ] **T014** Update Coin entity in `libs/database/entities/coin.entity.ts`
  - Add slug field with @Column decorator and @Index
  - Add description field (text, nullable)
  - Add links field (jsonb, nullable)
  - Add metadataLastUpdated field (timestamp, nullable)
  - Add slug validation decorator
  - **Validation**: TypeScript builds without errors, T001 migration matches entity

### Backend - Service Layer

- [ ] **T015** Add slug utilities to `apps/api/src/coin/coin.service.ts`
  - Implement `generateSlug(name: string): string` method
  - Handle slug collision by appending incremental number
  - **Validation**: T008 unit tests pass

- [ ] **T016** Add CoinGecko integration to `apps/api/src/coin/coin.service.ts`
  - Create `CoinGeckoService` or add methods to existing service
  - Implement `fetchCoinDetail(coinGeckoId: string): Promise<CoinGeckoDetailDto>` with Redis cache
  - Implement `fetchMarketChart(coinGeckoId: string, days: number): Promise<CoinGeckoChartDto>` with cache
  - Handle rate limiting (429 → use cached data + warning log)
  - Set 5-minute TTL on Redis cache
  - **Validation**: T009 unit tests pass, Redis cache working

- [ ] **T017** Add `getCoinDetailBySlug` method to `apps/api/src/coin/coin.service.ts`
  - Query coin by slug from database
  - Fetch additional data from CoinGecko (if metadata stale)
  - Merge database + CoinGecko data into `CoinDetailResponseDto`
  - Throw NotFoundException if slug not found
  - **Validation**: Method returns correct DTO structure

- [ ] **T018** Add `getMarketChart` method to `apps/api/src/coin/coin.service.ts`
  - Query coin by slug
  - Map period ('24h', '7d', '30d', '1y') to days (1, 7, 30, 365)
  - Fetch from CoinGecko with caching
  - Transform to `MarketChartResponseDto` format
  - **Validation**: Method returns chart data for all periods

- [ ] **T019** Add `getHoldingsByCoin` method to `apps/api/src/order/order.service.ts`
  - Query orders filtered by userId and coinSymbol
  - Calculate: buys - sells = total amount
  - Calculate: weighted average buy price
  - Group holdings by exchange
  - Return `UserHoldingsDto` structure
  - Handle edge case: no orders → return zero holdings
  - **Validation**: T010 unit tests pass

### Backend - Controller Layer

- [ ] **T020** Add GET `/coins/:slug` endpoint to `apps/api/src/coin/coin.controller.ts`
  - Create `@Get(':slug')` route
  - Extract slug from params with validation
  - Extract user from JWT (optional, use `@OptionalAuth()` decorator if available)
  - Call `coinService.getCoinDetailBySlug(slug, userId)`
  - If authenticated, enrich response with holdings via `orderService.getHoldingsByCoin`
  - Return `CoinDetailResponseDto`
  - Handle NotFoundException → 404 response
  - **Validation**: T004 and T005 integration tests pass

- [ ] **T021** Add GET `/coins/:slug/chart` endpoint to `apps/api/src/coin/coin.controller.ts`
  - Create `@Get(':slug/chart')` route
  - Extract slug and period query param with validation
  - Validate period enum ('24h' | '7d' | '30d' | '1y')
  - Call `coinService.getMarketChart(slug, period)`
  - Return `MarketChartResponseDto`
  - Handle invalid period → 400 BadRequest
  - Handle invalid slug → 404 NotFound
  - **Validation**: T006 integration tests pass

- [ ] **T022** Add GET `/coins/:slug/holdings` endpoint to `apps/api/src/coin/coin.controller.ts`
  - Create `@Get(':slug/holdings')` route with `@UseGuards(JwtAuthGuard)`
  - Extract slug and userId from authenticated request
  - Query coin to get symbol
  - Call `orderService.getHoldingsByCoin(userId, coinSymbol)`
  - Return `UserHoldingsDto`
  - Handle no holdings → 404 or empty response
  - **Validation**: T007 integration tests pass

### Frontend - Routing

- [ ] **T023** Add coin detail route to `apps/chansey/src/app/app.routes.ts`
  - Add route: `{ path: 'coins/:slug', loadComponent: () => import('...CoinDetailComponent') }`
  - Ensure lazy loading for code-splitting
  - **Validation**: Navigate to `/coins/bitcoin`, component loads

### Frontend - Query Hooks

- [ ] **T024 [P]** Create TanStack Query hooks in `apps/chansey/src/app/coins/services/coin-detail.queries.ts`
  - Implement `useCoinDetailQuery(slug)` with 1min stale time
  - Implement `useCoinPriceQuery(slug)` with 45s refetchInterval, 30s stale time
  - Implement `useCoinHistoryQuery(slug, period)` with 5min stale time
  - Implement `useUserHoldingsQuery(slug, userId)` with conditional enabled
  - Add JSDoc comments explaining each hook's purpose
  - **Validation**: T013 unit tests pass

### Frontend - Sub-Components

- [ ] **T025 [P]** Create PriceChartComponent in `apps/chansey/src/app/coins/components/price-chart/`
  - Standalone component with PrimeNG Chart (Chart.js wrapper)
  - Input: `@Input() chartData: MarketChartResponseDto`
  - Time period selector using PrimeNG TabView (24h, 7d, 30d, 1y)
  - Output: `@Output() periodChange: EventEmitter<TimePeriod>`
  - Configure Chart.js: line chart, responsive, grid lines
  - Color: green for positive change, red for negative
  - Handle empty data with placeholder message
  - **Validation**: T012 unit tests pass, chart renders correctly

- [ ] **T026 [P]** Create MarketStatsComponent in
      `apps/chansey/src/app/coins/components/market-stats/market-stats.component.ts`
  - Standalone component with PrimeNG Card
  - Display: Market Cap, 24h Volume, Circulating Supply
  - Format large numbers (845B instead of 845000000000)
  - Optional fields: Total Supply, Max Supply, Market Cap Rank
  - Responsive grid layout (3 cols desktop, 1 col mobile)
  - **Validation**: Renders stats correctly, responsive on mobile

- [ ] **T027 [P]** Create HoldingsCardComponent in
      `apps/chansey/src/app/coins/components/holdings-card/holdings-card.component.ts`
  - Standalone component with PrimeNG Card
  - Input: `@Input() holdings: UserHoldingsDto`
  - Display: Total Amount, Avg Buy Price, Current Value, P/L, P/L %
  - Color-code profit (green) / loss (red)
  - List exchanges with individual amounts
  - Last synced timestamp per exchange
  - View-only (no action buttons)
  - Clear visual distinction from public market data
  - **Validation**: Holdings display accurately, no edit/remove buttons

- [ ] **T028 [P]** Create ExternalLinksComponent in
      `apps/chansey/src/app/coins/components/external-links/external-links.component.ts`
  - Standalone component
  - Input: `@Input() links: CoinLinksDto`
  - Display links grouped by category (Website, Explorer, GitHub, Reddit)
  - Handle missing/empty link arrays gracefully
  - Open links in new tab (target="\_blank" rel="noopener noreferrer")
  - Accessibility: adequate touch target size, keyboard navigable
  - **Validation**: Links render, open in new tab, accessible

### Frontend - Main Component

- [ ] **T029** Create CoinDetailComponent in `apps/chansey/src/app/coins/coin-detail/coin-detail.component.ts`
  - Standalone component
  - Extract slug from route params via ActivatedRoute
  - Use query hooks from T024 (detail, price, history, holdings)
  - Default chart period: 24h
  - Combine detail + price queries for auto-refresh
  - Conditional holdings query (only if user authenticated)
  - Handle period change: update `useCoinHistoryQuery` key
  - **Validation**: Component logic works, queries fire correctly

- [ ] **T030** Create CoinDetailComponent template in
      `apps/chansey/src/app/coins/coin-detail/coin-detail.component.html`
  - Header: Coin name, symbol, logo, current price, 24h change
  - Loading state: PrimeNG Skeleton screens for all sections
  - Error state: Error message with retry button
  - Market stats section (use MarketStatsComponent)
  - Price chart section (use PriceChartComponent)
  - Description section with HTML sanitization
  - External links section (use ExternalLinksComponent)
  - Holdings section (use HoldingsCardComponent, \*ngIf authenticated)
  - Back navigation: breadcrumb or back button to coins list
  - **Validation**: T011 unit tests pass, UI renders correctly

- [ ] **T031** Style CoinDetailComponent in `apps/chansey/src/app/coins/coin-detail/coin-detail.component.scss`
  - Mobile-first responsive design (TailwindCSS utility classes)
  - Stack sections vertically on mobile (<768px)
  - Grid layout on desktop (2 cols for stats cards)
  - Adequate spacing between sections
  - WCAG AA contrast ratios (4.5:1 minimum)
  - Focus indicators for keyboard navigation
  - **Validation**: Passes WCAG contrast checker, responsive on mobile

---

## Phase 3.4: Integration & Polish

### Auto-Refresh Implementation

- [ ] **T032** Add visual refresh indicator to CoinDetailComponent
  - Show loading spinner/icon during `isFetching` state from TanStack Query
  - Position indicator near price (non-intrusive)
  - Ensure indicator doesn't cause layout shift
  - **Validation**: Indicator appears during refetch, disappears after

### Error Handling

- [ ] **T033** Implement 404 page for invalid coin slug
  - Display error message: "Coin not found"
  - Show suggested action: "Return to Coins List" button
  - Navigate to `/coins` on button click
  - **Validation**: Navigate to `/coins/invalid-slug`, see 404 page

- [ ] **T034 [P]** Add error handling for incomplete coin data
  - Handle missing description: show "Description not available"
  - Handle missing links: hide empty link sections
  - Handle missing chart data: show "Limited data available" message
  - Test with coin that has sparse data
  - **Validation**: Page renders without crashes, graceful degradation

### Performance Optimization

- [ ] **T035 [P]** Implement lazy loading for chart library
  - Code-split Chart.js via dynamic import: `import('chart.js')`
  - Load chart library only when price chart visible (viewport intersection)
  - **Validation**: Network tab shows chart.js loads separately, bundle <500KB

- [ ] **T036 [P]** Add Redis cache monitoring for CoinGecko calls
  - Log cache hit/miss ratios
  - Monitor API call frequency to CoinGecko
  - Ensure 5min TTL reduces API calls by ~90%
  - **Validation**: Logs show high cache hit ratio, API calls within rate limits

### Accessibility

- [ ] **T037 [P]** Add ARIA labels and semantic HTML
  - Semantic headings (h1 for coin name, h2 for sections)
  - ARIA labels on chart tabs: `aria-label="24 hour period"`
  - ARIA live regions for price updates: `aria-live="polite"`
  - Alt text for coin logo
  - **Validation**: Screen reader announces elements correctly

- [ ] **T038 [P]** Ensure keyboard navigation
  - All interactive elements focusable (Tab key)
  - Chart period tabs navigable with Arrow keys
  - Focus visible (outline) on all elements
  - Focus order logical (top to bottom)
  - **Validation**: Navigate entire page with keyboard only

### Testing & Validation

- [ ] **T039 [P]** Add unit tests for utility functions
  - Test slug generation edge cases
  - Test number formatting (large numbers)
  - Test profit/loss percentage calculations
  - **Validation**: 80%+ code coverage on utilities

- [ ] **T040** Run full test suite and fix failures
  - Run `npm run test` - all tests pass
  - Run `nx build api` - builds successfully
  - Run `nx build chansey` - builds successfully
  - Run `nx lint api && nx lint chansey` - no errors
  - **Validation**: CI/CD pipeline green

- [ ] **T041** Execute quickstart.md manual testing scenarios
  - Complete all 12 test scenarios from `specs/004-create-a-dedicated/quickstart.md`
  - Test on Chrome, Firefox, Safari
  - Test on mobile device or simulator
  - Document any issues found
  - **Validation**: All scenarios pass, no critical bugs

### Performance Validation

- [ ] **T042** Measure and validate performance metrics
  - Chrome DevTools → Performance tab
  - Hard reload `/coins/bitcoin`, record metrics
  - Verify: FCP <2s, TTI <3.5s, LCP <2.5s, CLS <0.1
  - Verify: API response time <150ms (Network tab)
  - Verify: Bundle size <500KB gzipped (Coverage tab)
  - **Validation**: All performance targets met

### Documentation

- [ ] **T043 [P]** Update API documentation
  - Ensure Swagger/OpenAPI auto-generates docs for new endpoints
  - Verify `/api/docs` shows coin detail endpoints
  - Add JSDoc comments to all public service methods
  - **Validation**: API docs complete and accurate

- [ ] **T044 [P]** Update CLAUDE.md with new feature
  - Add Coin Detail Page section to architecture notes
  - Document: URL structure, auto-refresh pattern, hybrid data approach
  - Add common troubleshooting tips
  - **Validation**: CLAUDE.md updated, under 200 lines

---

## Dependencies

**Critical Path**:

```
T001 (migration) → T014 (entity) → T015-T019 (services) → T020-T022 (endpoints)
                                                                ↓
T023 (routing) → T024 (queries) → T025-T028 (sub-components) → T029-T031 (main component)
                                                                ↓
                                              T032-T038 (integration) → T039-T044 (polish)
```

**Blocking Dependencies**:

- Tests (T003-T013) must be written BEFORE implementation (T014-T031)
- T014 (entity) blocks T017-T018 (service methods using entity)
- T019 (holdings calculation) blocks T020 (detail endpoint with holdings)
- T024 (query hooks) blocks T029 (component using hooks)
- T025-T028 (sub-components) block T030 (template using sub-components)
- Implementation (T014-T031) blocks polish (T032-T044)

**Independent Tasks (Can Parallelize)**:

- Phase 3.2 Tests: T003-T013 all [P] (different test files)
- T002 (DTOs) parallel with tests
- T025-T028 (sub-components) all [P] (different component files)
- T034-T038 (polish tasks) all [P] (different concerns)
- T039, T043, T044 all [P] (documentation)

---

## Parallel Execution Examples

### Execute all contract/integration tests in parallel:

```bash
# Launch tests T003-T013 together (different files):
npm run test -- coingecko-api.contract.spec.ts &
npm run test -- coin.controller.spec.ts &
npm run test -- order.service.spec.ts &
npm run test -- coin-detail.component.spec.ts &
npm run test -- price-chart.component.spec.ts &
npm run test -- coin-detail.queries.spec.ts &
wait
```

### Execute sub-component creation in parallel:

```bash
# Generate T025-T028 together (independent components):
nx g component coins/components/price-chart --standalone &
nx g component coins/components/market-stats --standalone &
nx g component coins/components/holdings-card --standalone &
nx g component coins/components/external-links --standalone &
wait
```

### Execute polish tasks in parallel:

```bash
# Run T034-T038 together (different concerns):
# T034: Error handling
# T035: Performance optimization
# T036: Cache monitoring
# T037: ARIA labels
# T038: Keyboard navigation
# Each task modifies different parts of the codebase
```

---

## Validation Checklist

_GATE: Verify before marking feature complete_

- [x] All contracts (`contracts/coin-detail-api.yaml`) have corresponding tests
- [x] All entities (`Coin`) have migration and extension tasks
- [x] All tests (T003-T013) come before implementation (T014-T031)
- [x] Parallel tasks truly independent (different files, no shared state)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] TDD workflow enforced: fail → implement → pass
- [x] Brownfield constraints respected (extend, don't scaffold)
- [x] Performance targets defined and measurable
- [x] Accessibility requirements included
- [x] Manual testing scenarios from quickstart.md included (T041)

---

## Notes

- **Brownfield Reminder**: This feature extends the existing coin module. Do NOT create a new NestJS module. Modify
  `apps/api/src/coin/` files only.
- **TDD Enforcement**: Reviewers must verify tests fail before implementation. CI should block PRs with passing tests
  that have no implementation.
- **Parallel Safety**: [P] tasks can run concurrently in separate terminals or CI jobs. Non-[P] tasks must run
  sequentially.
- **Commit Strategy**: Commit after each task completion. Use conventional commits:
  `feat(coin-detail): T020 add GET /coins/:slug endpoint`.
- **Performance**: Run T042 on a throttled 3G connection to validate targets.
- **Accessibility**: Use axe DevTools or Lighthouse to validate WCAG compliance during T037-T038.

---

## Task Count: 44 tasks total

- Setup: 2 tasks (T001-T002)
- Tests: 11 tasks (T003-T013)
- Implementation: 18 tasks (T014-T031)
- Polish: 13 tasks (T032-T044)

**Estimated Completion**: 4-6 days for experienced developer (TDD adds 30% time, saves 50% debugging time)

---

**Generated**: 2025-10-22 **Ready for Execution**: ✅ All tasks are specific, ordered, and immediately executable
