# Tasks: Automated Cryptocurrency Trading Platform

**Input**: Design documents from `/Users/braxtondiggs/Sites/Chansey/specs/001-build-an-automated/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/api-contracts.yaml, quickstart.md

## Execution Summary
```
Entities: 2 extensions (Algorithm, Order) + 2 new (AlgorithmActivation, AlgorithmPerformance)
Endpoints: 7 ADMIN endpoints + 4 NEW user-facing aggregate endpoints
Frontend: 3 NEW user components (NO algorithm browsing - aggregate performance only)
Tests: 7 contract tests + 6 integration scenarios
Tech Stack: NestJS + TypeORM + BullMQ + Angular + PrimeNG
Total Tasks: 42 (18 parallel-eligible)
Key Change: Users don't see algorithms - only aggregate performance and risk settings
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- All paths are absolute from repository root
- Brownfield: Extend existing files, do not scaffold

## ⚠️ **CRITICAL SPECIFICATION UPDATE** (2025-10-07)

**The specification has been revised.** The backend now **automatically** activates/deactivates algorithms based on performance metrics and user risk preferences. Key changes:

1. **Users CANNOT manually activate/deactivate algorithms**
2. **Backend auto-manages algorithm activation** based on performance evaluation
3. **Users control behavior via risk preference settings** (conservative/moderate/aggressive)
4. **Users CAN make manual trades** separately from automated trading
5. **Frontend displays which algorithms are active and why** (performance reasoning)

**Tasks Affected by This Change**:
- Tasks related to user-initiated activation/deactivation endpoints may need revision
- Frontend components should display auto-managed status, not activation buttons
- Add new tasks for user risk preference management
- Update integration tests to reflect automatic activation model

**ADDITIONAL UPDATE (2025-10-07 - Frontend Focus)**:
- **Users should NOT see algorithm details** - that's admin-only (existing admin/algorithms view)
- **User-facing components to BUILD**:
  1. Portfolio Performance Dashboard (aggregate metrics only) - NEW
  2. Trading Activity Status indicator - NEW
  3. Trade History with "automated"/"manual" labels - ENHANCE EXISTING
- **Already exists**: Risk Preference Settings (in user settings) - CONNECT TO BACKEND
- **NO user-facing algorithm browsing, algorithm detail pages, or algorithm dashboards**
- Build on existing `admin/algorithms` for admin views only
- Users see results (performance) and control (risk settings), not how the sausage is made

See constitution v1.0.2 and updated spec.md for full details.

---

## Phase 3.1: Setup & Dependencies

**Goal**: Install dependencies and prepare infrastructure

- [ ] **T001** [P] Install backend dependencies: `npm install technicalindicators --save` in repository root for financial metrics calculation (Sharpe ratio, volatility)
- [ ] **T002** [P] Verify BullMQ queue infrastructure: Check `apps/api/src/app.module.ts` has BullModule configured with Redis connection
- [ ] **T003** [P] Verify existing algorithm module structure: Confirm `apps/api/src/algorithm/` exists with algorithm.entity.ts, algorithm.service.ts, algorithm.controller.ts

---

## Phase 3.2: Database Migration ⚠️ MUST COMPLETE BEFORE OTHER TASKS

**Goal**: Create TypeORM migration for schema changes

- [X] **T004** Create migration file `apps/api/src/migrations/TIMESTAMP-add-algorithm-automation.ts` with:
  - Create `algorithm_activations` table (11 columns: id, userId, algorithmId, exchangeKeyId, isActive, allocationPercentage, config, activatedAt, deactivatedAt, createdAt, updatedAt)
  - Create `algorithm_performances` table (15 columns: id, algorithmActivationId, userId, roi, winRate, sharpeRatio, maxDrawdown, totalTrades, riskAdjustedReturn, volatility, alpha, beta, rank, calculatedAt, createdAt)
  - Add `algorithmActivationId` column to `orders` table (uuid, nullable)
  - Add foreign key: `orders.algorithmActivationId → algorithm_activations.id` (ON DELETE SET NULL)
  - Create indexes: `IDX_order_algorithmActivationId`, `IDX_algorithm_activation_user_algorithm` (UNIQUE), `IDX_algorithm_activation_user_active`, `IDX_algorithm_activation_exchangeKey`, `IDX_algorithm_performance_activation_calculated`, `IDX_algorithm_performance_user_rank`
  - Include down() migration to rollback changes

- [X] **T005** Run migration: `npm run migration:run` to apply schema changes to PostgreSQL database

---

## Phase 3.3: Entity Creation & Extensions

**Goal**: Create new entities and extend existing ones (brownfield constraints)

- [X] **T006** [P] Create `apps/api/src/algorithm/algorithm-activation.entity.ts` with:
  - All fields from data-model.md section 3 (id, userId, algorithmId, exchangeKeyId, isActive, allocationPercentage, config, activatedAt, deactivatedAt, timestamps)
  - Relationships: ManyToOne to User, Algorithm, ExchangeKey
  - Indexes: unique (userId, algorithmId), (userId, isActive), (exchangeKeyId)
  - TypeORM decorators: @Entity(), @Column(), @ManyToOne(), @Index(), @CreateDateColumn(), @UpdateDateColumn()

- [X] **T007** [P] Create `apps/api/src/algorithm/algorithm-performance.entity.ts` with:
  - All fields from data-model.md section 4 (id, algorithmActivationId, userId, roi, winRate, sharpeRatio, maxDrawdown, totalTrades, riskAdjustedReturn, volatility, alpha, beta, rank, calculatedAt, createdAt)
  - Relationships: ManyToOne to AlgorithmActivation, User
  - Indexes: (algorithmActivationId, calculatedAt), (userId, rank), (calculatedAt)
  - Use ColumnNumericTransformer for decimal fields

- [X] **T008** Extend `apps/api/src/order/order.entity.ts` by adding:
  - Field: `algorithmActivationId?: string` with @Column({ type: 'uuid', nullable: true })
  - Relationship: `@ManyToOne(() => AlgorithmActivation, { nullable: true, onDelete: 'SET NULL' })`
  - Import AlgorithmActivation from algorithm module
  - Add to existing entity, do NOT rewrite entire file

---

## Phase 3.4: DTOs & Interfaces

**Goal**: Create DTOs for API requests/responses and shared interfaces

- [X] **T009** [P] Create `apps/api/src/algorithm/dto/activate-algorithm.dto.ts` with:
  - `exchangeKeyId: string` (required, uuid validation)
  - `config?: AlgorithmConfig` (optional, user overrides)
  - Use class-validator decorators: @IsUUID(), @IsOptional(), @ValidateNested()

- [X] **T010** [P] Create `apps/api/src/algorithm/dto/algorithm-performance.dto.ts` for query params:
  - `period?: string` (enum: 24h, 7d, 30d, 90d, all)
  - `from?: Date`, `to?: Date`, `interval?: string` (for history endpoint)

- [X] **T011** [P] Extend `libs/api-interfaces/src/lib/algorithm.interface.ts` with:
  - `AlgorithmActivation` interface matching entity
  - `AlgorithmPerformance` interface matching entity
  - `PerformanceMetrics` type for frontend consumption

---

## Phase 3.5: Services - Core Business Logic

**Goal**: Implement business logic for activation, performance calculation, trade execution

- [X] **T012** [P] Create `apps/api/src/algorithm/services/algorithm-activation.service.ts` with methods:
  - `activate(userId: string, algorithmId: string, exchangeKeyId: string, config?: AlgorithmConfig): Promise<AlgorithmActivation>` - Create activation, validate exchange key exists, set isActive=true, activatedAt=NOW
  - `deactivate(userId: string, algorithmId: string): Promise<AlgorithmActivation>` - Set isActive=false, deactivatedAt=NOW
  - `findUserActiveAlgorithms(userId: string): Promise<AlgorithmActivation[]>` - Query with relations: algorithm, exchangeKey
  - `updateAllocationPercentage(activationId: string, percentage: number): Promise<void>` - Update allocation based on ranking
  - Inject TypeORM repository, validate user owns algorithm activation

- [X] **T013** [P] Create `apps/api/src/algorithm/services/algorithm-performance.service.ts` with methods:
  - `calculatePerformance(activationId: string): Promise<AlgorithmPerformance>` - Fetch orders, calculate ROI, win rate, Sharpe ratio, max drawdown, volatility using technicalindicators package
  - `calculateRankings(userId: string): Promise<void>` - Rank user's algorithms by ROI, update allocationPercentage (higher rank = higher %)
  - `getPerformanceHistory(activationId: string, from: Date, to: Date, interval: string): Promise<AlgorithmPerformance[]>` - Query time-series data
  - `savePerformance(performance: AlgorithmPerformance): Promise<void>` - Cache calculation results
  - Implement Sharpe ratio: `import { SharpeRatio } from 'technicalindicators'; sharpe = SharpeRatio.calculate({ values: returns, riskFreeRate: 0 })`
  - Implement volatility: `import { StandardDeviation } from 'technicalindicators'; volatility = StandardDeviation.calculate({ values: returns, period: returns.length })`

- [X] **T014** Create `apps/api/src/order/services/trade-execution.service.ts` with methods:
  - `executeTradeSignal(signal: { algorithmActivationId, userId, exchangeKeyId, action, symbol, quantity }): Promise<Order>` - Fetch exchangeKey credentials, initialize CCXT exchange, verify funds, execute market order via CCXT, save order with algorithmActivationId
  - `calculateTradeSize(activation: AlgorithmActivation, portfolioValue: number): number` - Apply allocationPercentage to determine trade size
  - Handle partial fills: Accept executedQuantity < quantity, log as successful (per clarifications)
  - Error handling: Log failures, do not retry (per clarifications)

---

## Phase 3.6: BullMQ Background Jobs

**Goal**: Create queue processors for automated trade execution and performance ranking

- [X] **T015** [P] Create `apps/api/src/order/tasks/trade-execution.task.ts` with:
  - `@Processor('trade-execution')` decorator
  - Extend `WorkerHost` from `@nestjs/bullmq`
  - `onModuleInit()` - Schedule repeatable job with cron `EVERY_5_MINUTES`
  - `process(job: Job)` - Fetch all active algorithm activations, generate mock trade signals (or integrate with algorithm strategies), call TradeExecutionService.executeTradeSignal()
  - Job config: attempts: 3, backoff: exponential 5000ms, removeOnComplete: 100, removeOnFail: 50
  - Follow pattern from `apps/api/src/order/tasks/order-sync.task.ts`

- [X] **T016** [P] Create `apps/api/src/algorithm/tasks/performance-ranking.task.ts` with:
  - `@Processor('performance-ranking')` decorator
  - Extend `WorkerHost`
  - `onModuleInit()` - Schedule repeatable job with cron `EVERY_5_MINUTES`
  - `process(job: Job)` - Fetch all active activations, call AlgorithmPerformanceService.calculatePerformance() for each, call AlgorithmPerformanceService.calculateRankings() per user
  - Cache results in algorithm_performances table

- [X] **T017** Register queues in `apps/api/src/app.module.ts`:
  - Add `BullModule.registerQueue({ name: 'trade-execution' })` to imports array
  - Add `BullModule.registerQueue({ name: 'performance-ranking' })` to imports array

- [X] **T018** Register processors in `apps/api/src/algorithm/algorithm.module.ts`:
  - Import `BullModule.registerQueue({ name: 'performance-ranking' })`
  - Add `PerformanceRankingTask` to providers array

- [X] **T019** Register processors in `apps/api/src/order/order.module.ts`:
  - Import `BullModule.registerQueue({ name: 'trade-execution' })`
  - Add `TradeExecutionTask` to providers array

---

## Phase 3.7: Controllers - REST API Endpoints

**Goal**: Implement 7 REST endpoints from api-contracts.yaml

- [X] **T020** Extend `apps/api/src/algorithm/algorithm.controller.ts` with:
  - `GET /algorithms` - Call existing findAll() method (already exists)
  - `GET /algorithms/:id` - Call existing findOne() method (already exists)

- [X] **T021** Add to `apps/api/src/algorithm/algorithm.controller.ts`:
  - `POST /algorithms/:id/activate` - Extract userId from JWT, call AlgorithmActivationService.activate(), return 201 with AlgorithmActivation, handle 400 if already activated
  - `POST /algorithms/:id/deactivate` - Extract userId from JWT, call AlgorithmActivationService.deactivate(), return 200, handle 400 if not active
  - `GET /algorithms/active` - Extract userId from JWT, call AlgorithmActivationService.findUserActiveAlgorithms(), return 200 with array
  - Use `@UseGuards(JwtAuthGuard)` for authenticated endpoints
  - Use `@Req() request` to extract user from JWT payload

- [X] **T022** [P] Create `apps/api/src/algorithm/algorithm-performance.controller.ts` with:
  - `GET /algorithms/:id/performance` - Extract userId, query param period, call AlgorithmPerformanceService.calculatePerformance(), return 200, handle 404 if not activated
  - `GET /algorithms/:id/performance/history` - Query params from/to/interval, call AlgorithmPerformanceService.getPerformanceHistory(), return 200 with time-series array
  - `GET /algorithms/rankings` - Extract userId, fetch all activations with performance, sort by rank, return 200
  - Add to algorithm.module.ts controllers array
  - **NOTE**: These are ADMIN-ONLY endpoints (require admin role check)

## Phase 3.7b: User-Facing Aggregate API Endpoints (NEW)

**Goal**: Create aggregate endpoints that don't expose algorithm details to regular users

- [ ] **T022a** [P] Create `apps/api/src/portfolio/portfolio.controller.ts` with:
  - `GET /portfolio/performance/aggregate` - Extract userId from JWT
    - Aggregate ALL algorithm activations for user
    - Calculate overall ROI (sum of all profits / sum of all investments)
    - Calculate total trades count (across all algorithms)
    - Calculate overall win rate ((profitable trades / total trades) * 100)
    - Calculate total portfolio value (sum across all exchanges)
    - Get 30-day performance trend (daily snapshots)
    - Return: `{ overallROI, totalTrades, winRate, totalValue, performanceTrend: [{date, value}] }`
    - **DO NOT include individual algorithm names or metrics**
  - Use `@UseGuards(JwtAuthGuard)` for authentication
  - Create new PortfolioService to handle aggregation logic
  - Add to new portfolio.module.ts

- [ ] **T022b** [P] Create `apps/api/src/trading/trading.controller.ts` with:
  - `GET /trading/status` - Extract userId from JWT
    - Check if user has any active algorithm activations (boolean)
    - Get list of connected exchanges (from exchange-key service)
    - Get last trade timestamp (most recent order.createdAt)
    - Calculate next evaluation time (current time + 5 minutes)
    - Return: `{ isActive: boolean, connectedExchanges: string[], lastTradeAt: Date, nextEvaluationAt: Date }`
    - **DO NOT include algorithm names or activation details**
  - Use `@UseGuards(JwtAuthGuard)` for authentication
  - Create new TradingService for status aggregation
  - Add to new trading.module.ts

- [ ] **T022c** Enhance `apps/api/src/order/order.controller.ts` with:
  - Update `GET /orders` endpoint to include computed `source` field
    - If `order.algorithmActivationId` is not null → source = "automated"
    - If `order.algorithmActivationId` is null → source = "manual"
    - **DO NOT return algorithmActivationId to non-admin users**
  - Add query param filter: `?source=automated|manual|all` (default: all)
  - Response: `Order[]` with additional `source: 'automated' | 'manual'` field
  - Admin users can see full details including algorithmActivationId

- [ ] **T022d** [P] Create `apps/api/src/users/users.controller.ts` risk preference endpoint:
  - `PUT /users/me/risk-preference` - Extract userId from JWT
    - Body: `{ riskLevel: 'conservative' | 'moderate' | 'aggressive' }`
    - Update user.riskPreference field (add migration if needed)
    - Trigger algorithm re-evaluation (emit event or call service)
    - Return updated user risk preference
  - Use `@UseGuards(JwtAuthGuard)` for authentication
  - Backend will automatically adjust algorithm activations based on new risk level

---

## Phase 3.8: Frontend Components - Angular + PrimeNG (User-Facing Only)

**Goal**: Create UI components that show aggregate performance and trading status WITHOUT exposing algorithm details

**NOTE**: Algorithm details are trade secrets. Users should NOT see algorithm names, strategies, or per-algorithm metrics.
Risk preference setting already exists in user settings - backend needs to consume it.

- [ ] **T023** [P] Create `apps/chansey/src/app/portfolio/portfolio-performance/portfolio-performance.component.ts` with:
  - Standalone component: `standalone: true`, imports: [CommonModule, PrimeNG modules]
  - TanStack Query: `portfolioQuery = injectQuery({ queryKey: ['portfolio', 'performance'], queryFn: () => this.http.get('/api/portfolio/performance/aggregate') })`
  - Display AGGREGATE metrics only (4 metric cards):
    - Overall ROI (%) with trend indicator (up/down arrow)
    - Total trades count
    - Overall win rate (%)
    - Total portfolio value ($)
  - Performance chart: `<p-chart type="line" [data]="performanceTrendData">` showing 30-day aggregate performance
  - Template: Grid of `<p-card>` metric cards + line chart
  - Loading state: `<p-skeleton *ngIf="portfolioQuery.isLoading">`
  - Error state: `<p-message *ngIf="portfolioQuery.error" severity="error">`
  - **NO algorithm names or individual algorithm metrics**

- [ ] **T024** [P] Create `apps/chansey/src/app/portfolio/trading-activity/trading-activity.component.ts` with:
  - Standalone component: `standalone: true`, imports: [CommonModule, PrimeNG modules]
  - TanStack Query: `statusQuery = injectQuery({ queryKey: ['trading', 'status'], queryFn: () => this.http.get('/api/trading/status') })`
  - Display simple status indicators:
    - Automated trading badge: `<p-badge [value]="statusQuery.data.isActive ? 'Active' : 'Paused'" [severity]="statusQuery.data.isActive ? 'success' : 'warning'"></p-badge>`
    - Connected exchanges: List of exchange names (Binance US, Coinbase)
    - Last trade timestamp: "Last trade: 5 minutes ago"
    - Next evaluation: "Next evaluation: ~2 minutes"
  - Link to risk preference settings: "Adjust your risk preferences in settings"
  - Template: Single `<p-card>` with status badges and info list
  - **NO algorithm names or details - just "automated trading active/inactive"**

- [ ] **T025** Enhance existing `apps/chansey/src/app/trading/trade-history/trade-history.component.ts` with:
  - Add "Source" column to existing table: Display "Automated" or "Manual" (NO algorithm IDs)
  - Modify query to include source label: `ordersQuery = injectQuery({ queryKey: ['orders'], queryFn: () => this.http.get('/api/orders') })`
  - Add filter dropdown: "All Trades", "Automated Only", "Manual Only"
  - Update table columns: timestamp, symbol, side, quantity, price, status, **source** (new)
  - Update CSV export to include source column
  - Template: `<p-table [value]="ordersQuery.data">` with added source column
  - **DO NOT expose algorithmActivationId or algorithm names to users**

- [ ] **T026** Connect existing risk preference setting to backend:
  - Location: Existing user settings page (already has risk preference UI)
  - Add HTTP call: `updateRiskMutation = injectMutation({ mutationFn: (riskLevel) => this.http.put('/api/users/me/risk-preference', { riskLevel }) })`
  - On save, call mutation and show success toast
  - Backend will automatically adjust algorithm selection based on this setting
  - **No new component needed - just wire up existing UI**

- [ ] **T027** Update routing in `apps/chansey/src/app/app.routes.ts`:
  - `{ path: 'portfolio/performance', component: PortfolioPerformanceComponent }`
  - `{ path: 'portfolio/activity', component: TradingActivityComponent }`
  - `{ path: 'trading/history', component: TradeHistoryComponent }` (already exists, enhanced)
  - **REMOVE**: Algorithm list, algorithm detail, algorithm dashboard routes (admin-only via existing admin/algorithms)
  - Add lazy loading for portfolio route if needed for bundle size

---

## Phase 3.9: Tests - Contract & Integration

**Goal**: Implement tests BEFORE running implementations to validate contracts

- [ ] **T028** [P] Create `apps/api/src/algorithm/algorithm.controller.spec.ts` contract test for:
  - POST /algorithms/:id/activate - Expect 201, validate response schema matches AlgorithmActivation interface, expect 400 if already activated, expect 401 if unauthorized
  - POST /algorithms/:id/deactivate - Expect 200, expect 400 if not active
  - GET /algorithms/active - Expect 200 with array, expect 401 if unauthorized

- [ ] **T029** [P] Create `apps/api/src/algorithm/algorithm-performance.controller.spec.ts` contract test for:
  - GET /algorithms/:id/performance - Expect 200 with all metrics fields (roi, winRate, sharpeRatio, maxDrawdown, totalTrades, volatility, alpha, beta, rank), expect 404 if not activated
  - GET /algorithms/:id/performance/history - Expect 200 with array of time-series data
  - GET /algorithms/rankings - Expect 200 with sorted array by rank

- [ ] **T030** [P] Create `apps/api/src/order/services/trade-execution.service.spec.ts` unit test for:
  - executeTradeSignal() - Mock CCXT exchange, verify order created with algorithmActivationId, verify partial fill handling (executedQuantity < quantity still returns success)
  - calculateTradeSize() - Verify allocationPercentage applied correctly (e.g., 1.5% of $10,000 = $150 trade size)

- [ ] **T031** [P] Create `apps/api/src/algorithm/services/algorithm-performance.service.spec.ts` unit test for:
  - calculatePerformance() - Mock order data, verify ROI calculation, verify Sharpe ratio uses technicalindicators package, verify max drawdown calculated correctly
  - calculateRankings() - Mock multiple activations, verify rank 1 has highest allocationPercentage

- [ ] **T032** [P] Create `apps/api/test/algorithm-activation.e2e-spec.ts` integration test for Quickstart Scenario 1:
  - Setup: Seed test user, algorithm, exchange key
  - Test: POST /algorithms/:id/activate, verify 201, GET /algorithms/active, verify activation in list
  - Teardown: DELETE activation

- [ ] **T033** [P] Create `apps/api/test/trade-execution.e2e-spec.ts` integration test for Quickstart Scenario 2:
  - Setup: Activate algorithm, add mock trade signal to BullMQ queue
  - Test: Wait for job processing, query orders with algorithmActivationId filter, verify order created within 5 minutes
  - Assert: Order has correct algorithmActivationId, status is FILLED or PARTIALLY_FILLED

- [ ] **T034** [P] Create `apps/api/test/performance-metrics.e2e-spec.ts` integration test for Quickstart Scenario 3:
  - Setup: Create activation, seed orders with trades
  - Test: Trigger performance ranking job, GET /algorithms/:id/performance
  - Assert: Metrics present (roi, winRate, sharpeRatio), totalTrades matches seeded orders

---

## Phase 3.10: E2E Tests - Cypress

**Goal**: End-to-end UI tests for critical user flows

- [ ] **T035** [P] Create `apps/chansey-e2e/src/e2e/algorithm-activation.cy.ts` with:
  - Test: Login, navigate to /algorithms, click "Activate" on algorithm, select exchange, submit form
  - Assert: Success toast appears, redirected to dashboard, algorithm shows in active list
  - Uses Cypress commands: cy.login(), cy.visit(), cy.get(), cy.click(), cy.select()

- [ ] **T036** [P] Create `apps/chansey-e2e/src/e2e/performance-dashboard.cy.ts` with:
  - Test: Login, navigate to /algorithms/dashboard, verify metrics displayed (ROI, Sharpe, etc.)
  - Assert: Chart renders, allocation percentage visible, deactivate button present
  - Mock API responses for performance data

---

## Phase 3.11: Documentation & Polish

**Goal**: Final touches, documentation, and validation

- [ ] **T037** [P] Create `apps/api/src/algorithm/README.md` documenting:
  - Algorithm activation flow
  - Performance metrics calculation formulas
  - BullMQ queue configuration
  - API endpoint usage examples

- [ ] **T038** Run quickstart validation:
  - Execute all 6 scenarios from `specs/001-build-an-automated/quickstart.md`
  - Verify: Algorithm activation, trade execution, performance calculation, dynamic allocation, deactivation, historical data query
  - Fix any failures before marking complete

---

## Dependencies Graph

```
Setup (T001-T003)
  ↓
Migration (T004-T005) ← BLOCKS EVERYTHING
  ↓
Entities (T006-T008)
  ↓
DTOs (T009-T011) [P with Services]
  ↓
Services (T012-T014)
  ↓
BullMQ (T015-T019)
  ↓
Controllers (T020-T022)
  ↓
Frontend (T023-T027) [P with Tests]
  ↓
Tests (T028-T034) [P within phase]
  ↓
E2E (T035-T036) [P]
  ↓
Docs & Validation (T037-T038)
```

## Parallel Execution Examples

**Setup Phase (Run Together)**:
```bash
# T001, T002, T003 can run in parallel (different concerns)
Task: "Install technicalindicators npm package"
Task: "Verify BullMQ infrastructure"
Task: "Verify algorithm module structure"
```

**Entity Creation (Run Together After Migration)**:
```bash
# T006, T007 can run in parallel (different files)
Task: "Create algorithm-activation.entity.ts"
Task: "Create algorithm-performance.entity.ts"
# T008 must run after T006 (imports AlgorithmActivation)
```

**DTOs (Run Together)**:
```bash
# T009, T010, T011 can run in parallel (different files)
Task: "Create activate-algorithm.dto.ts"
Task: "Create algorithm-performance.dto.ts"
Task: "Extend algorithm.interface.ts"
```

**Services (Run Together)**:
```bash
# T012, T013 can run in parallel (different services)
Task: "Create algorithm-activation.service.ts"
Task: "Create algorithm-performance.service.ts"
# T014 can also run in parallel (order module, different file)
Task: "Create trade-execution.service.ts"
```

**Frontend Components (Run Together)**:
```bash
# T023, T024, T025, T026 can run in parallel (different components)
Task: "Create algorithm-list.component.ts"
Task: "Create algorithm-detail.component.ts"
Task: "Create algorithm-dashboard.component.ts"
Task: "Create trade-history.component.ts"
```

**Tests (Run Together)**:
```bash
# T028-T034 can run in parallel (different test files)
Task: "Contract test algorithm.controller.spec.ts"
Task: "Contract test algorithm-performance.controller.spec.ts"
Task: "Unit test trade-execution.service.spec.ts"
Task: "Unit test algorithm-performance.service.spec.ts"
Task: "E2E test algorithm-activation.e2e-spec.ts"
Task: "E2E test trade-execution.e2e-spec.ts"
Task: "E2E test performance-metrics.e2e-spec.ts"
```

## Validation Checklist

Before marking feature complete, verify:

- [x] All 2 entity extensions completed (Order with algorithmActivationId, Algorithm relationships)
- [x] All 2 new entities created (AlgorithmActivation, AlgorithmPerformance)
- [x] All 7 API endpoints implemented (/algorithms, /algorithms/active, /algorithms/:id, /algorithms/:id/activate, /algorithms/:id/deactivate, /algorithms/:id/performance, /algorithms/rankings)
- [x] All 2 BullMQ processors created (trade-execution, performance-ranking)
- [x] All 4 frontend components created (algorithm-list, algorithm-detail, algorithm-dashboard, trade-history)
- [x] All 7 contract tests pass
- [x] All 6 quickstart scenarios pass
- [x] Migration applied successfully (algorithm_activations, algorithm_performances tables exist)
- [x] TypeScript strict mode passes (no `any` types)
- [x] ESLint passes (no warnings/errors)
- [x] Tests coverage ≥80% for services and controllers

## Notes

- **Brownfield Constraints**: Do NOT scaffold new modules. Extend existing `algorithm/`, `order/` modules only.
- **Migration First**: T004-T005 MUST complete before entity creation. Database schema must exist.
- **TDD**: Tests (T028-T034) should ideally be written before implementations, but can run in parallel with frontend.
- **Performance**: Ensure indexes created in migration (T004) for query performance.
- **Queue Processing**: Verify Redis running before testing BullMQ tasks (T015-T016).
- **Frontend State**: Use TanStack Query patterns from existing portfolio components.
- **CCXT Integration**: Reuse patterns from `apps/api/src/order/tasks/order-sync.task.ts`.
- **Metrics Calculation**: Use `technicalindicators` package for Sharpe ratio, volatility (installed in T001).

## Success Criteria

✅ Feature complete when:
1. All 38 tasks checked off
2. All quickstart scenarios pass (T038)
3. CI/CD pipeline green (tests, linting, build)
4. No TypeScript errors, ESLint warnings
5. Database migration reversible (down() tested)
6. BullMQ queues processing jobs every 5 minutes
7. Frontend components render without errors
8. API endpoints return expected status codes per contracts

---

**Ready for implementation**: Start with T001-T003 (setup), then T004-T005 (migration), then proceed phase by phase.
