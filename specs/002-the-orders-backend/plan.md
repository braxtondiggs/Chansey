# Implementation Plan: Manual Order Placement System Overhaul

**Branch**: `002-the-orders-backend` | **Date**: 2025-10-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-the-orders-backend/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → ✅ Loaded successfully from /specs/002-the-orders-backend/spec.md
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → ✅ All clarifications resolved in spec (5/5 answered)
   → ✅ Project Type: Web application (Angular + NestJS)
3. Fill the Constitution Check section
   → ✅ COMPLETE - All gates verified
4. Evaluate Constitution Check section
   → ✅ PASS - No violations, aligns with constitutional principles
5. Execute Phase 0 → research.md
   → ✅ COMPLETE - Created /specs/002-the-orders-backend/research.md
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, CLAUDE.md
   → ✅ COMPLETE - All artifacts created:
      - data-model.md (13.9KB)
      - contracts/post-orders.json
      - contracts/post-orders-preview.json
      - contracts/delete-orders-id.json
      - contracts/get-orders.json
      - quickstart.md (12.7KB)
      - CLAUDE.md updated via update-agent-context.sh
7. Re-evaluate Constitution Check section
   → ✅ PASS - No new violations introduced by design
8. Plan Phase 2 → Describe task generation approach
   → ✅ COMPLETE - Task generation strategy documented
9. STOP - Ready for /tasks command
   → ✅ COMPLETE - /plan workflow finished successfully
```

**IMPORTANT**: The /plan command STOPS at step 8. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Brownfield Context
**IMPORTANT**: This is a BROWNFIELD feature. Respect existing modules and DB schema.

- **Project Layout**: Nx monorepo; NestJS API at `apps/api`; Angular frontend at `apps/chansey`
- **Existing Order Module**: `apps/api/src/order/` (order.entity.ts, order.service.ts, order.controller.ts, order-sync.task.ts)
- **Existing Trading UI**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts` (already has order placement forms, preview, Stop Loss/Stop Limit UI)
- **No Scaffolding**: Extend existing order module and crypto-trading component; do not create new pages or components
- **Stability**: Verify imports/providers remain stable; reference concrete file paths when proposing edits
- **Output Format**: Diffs/edits to existing files, NOT scaffolding new structures

## Summary

The Manual Order Placement System Overhaul addresses the broken and half-implemented order placement functionality by creating a complete, multi-exchange order placement interface. The system will support 7 order types (Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, OCO) with comprehensive validation, real-time balance checking, and order preview before submission. The solution leverages existing infrastructure (CCXT for exchange integration, BullMQ order-sync.task.ts for status updates, existing exchange key connections) while adding manual order placement capabilities alongside the existing automated algorithm-driven trading system.

**Technical Approach**: Extend the existing Order entity with fields for manual order types and parameters, create new API endpoints for order placement/preview/cancellation, build Angular components for the order placement UI with conditional forms per order type, and integrate with existing exchange services via CCXT for multi-exchange support.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS backend), TypeScript 5.x (Angular 19 frontend)
**Primary Dependencies**:
- Backend: NestJS 10.x, TypeORM 0.3.x, CCXT 4.x, class-validator, BullMQ
- Frontend: Angular 19, PrimeNG 17.x, TanStack Query (@tanstack/angular-query-experimental), RxJS
**Storage**: PostgreSQL 15+ (via TypeORM), Redis (caching + BullMQ job queues)
**Testing**:
- Backend: Jest for unit tests, Supertest for integration tests
- Frontend: Jest for unit tests, Cypress for E2E tests
**Target Platform**: Web application (browser + Node.js server)
**Project Type**: Web (Angular frontend + NestJS backend in Nx monorepo)
**Performance Goals**:
- API response: <200ms p95 for order validation, <500ms for order submission
- UI: Order form interaction <100ms, order preview <2s
- Concurrent capacity: 50 simultaneous order placements (10 max users)
**Constraints**:
- Must leverage existing exchange connections (no new exchange integrations)
- Must coexist with automated algorithm-driven trading (FR-026: distinguish manual vs automated)
- Must respect CCXT rate limits per exchange
- Order sync via existing order-sync.task.ts (manual refresh + background sync)
- Database connection pool sized for 10 concurrent users
**Scale/Scope**:
- 10 maximum concurrent users
- 7 order types with type-specific validation
- Support for all user-connected exchanges (dynamic)
- ~46 functional requirements, 12 non-functional requirements
- 4 primary user scenarios + 6 edge cases

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with `.specify/memory/constitution.md`:

### Code Quality Gates
- [x] ESLint and Prettier configurations will be followed (existing configs in place)
- [x] TypeScript strict mode enabled; no unjustified `any` types (strict mode already enabled)
- [x] Public API and complex logic will include JSDoc comments (will document order validation and CCXT integration)

### Testing Standards Gates
- [x] Unit tests planned for business logic (Jest, 80%+ coverage target)
  - Order validation service unit tests
  - Order placement service unit tests
  - Order type parameter validation unit tests
- [x] Integration tests planned for API endpoints
  - POST /api/orders (place order)
  - POST /api/orders/preview (order preview)
  - DELETE /api/orders/:id (cancel order)
  - GET /api/orders (list with filters)
- [x] E2E tests planned for critical user flows (Cypress)
  - Place market order end-to-end
  - Place limit order with preview
  - Cancel open order
- [x] Contract tests planned for external API integrations
  - CCXT order placement contracts per exchange type
  - CCXT balance fetching contracts

### User Experience Gates
- [x] PrimeNG components used for consistency
  - p-dropdown for exchange/pair selection
  - p-inputNumber for quantity/price inputs
  - p-button for actions
  - p-dialog for order preview modal
  - p-table for order history
- [x] Mobile-first responsive design approach (PrimeNG responsive utilities)
- [x] WCAG 2.1 AA accessibility compliance planned
  - Proper labels for form fields
  - Keyboard navigation support
  - Screen reader announcements for order status
- [x] Loading states and error handling patterns defined
  - TanStack Query loading/error states
  - Optimistic updates for order submission
  - Toast notifications for success/errors

### Architectural Consistency Gates
- [x] Follows Nx monorepo structure (apps vs libs separation)
  - Backend: apps/api/src/order/ (extend existing module)
  - Frontend: apps/chansey/src/app/pages/trading/ (new components)
  - Shared types: libs/api-interfaces/src/lib/order.interface.ts
- [x] Backend: NestJS domain modules with co-located TypeORM entities
  - Extend apps/api/src/order/order.entity.ts with new fields
  - Add methods to apps/api/src/order/order.service.ts
  - Extend apps/api/src/order/order.controller.ts with new endpoints
- [x] Frontend: Standalone Angular components with TanStack Query
  - Standalone OrderPlacementComponent
  - Standalone OrderHistoryComponent
  - Service with TanStack Query hooks (useCreateOrder, useOrderPreview, useCancelOrder)
- [x] Background jobs: BullMQ queues co-located with domain logic
  - Leverage existing apps/api/src/order/tasks/order-sync.task.ts
  - No new queues required (sync handles status updates)
- [x] Database changes: TypeORM migrations only
  - Migration to add order type fields (stopPrice, trailingAmount, etc.)
  - Migration to add isManual flag to distinguish from automated orders

### Performance Requirements Gates
- [x] API response time targets defined (<200ms p95 for CRUD)
  - Order validation: <2s (NFR-001)
  - Order submission: <3s (NFR-002)
  - Order preview calculation: <2s
- [x] Database queries will use indexes (no N+1 queries)
  - Index on orders.userId + orders.status for filtering
  - Index on orders.exchangeKeyId for multi-exchange queries
  - Eager loading for exchange/coin relationships
- [x] Caching strategy identified (Redis where appropriate)
  - Cache exchange trading pairs (5-min TTL)
  - Cache market prices for preview (30s TTL)
  - No caching of order status (sync task handles)
- [x] Frontend bundle size considerations (<500KB gzipped)
  - Lazy load trading module
  - PrimeNG tree-shakeable imports
- [x] Rate limiting patterns defined
  - Leverage CCXT built-in rate limiting (FR-032)
  - Client-side debouncing for order preview (500ms)
  - Double-submit prevention (FR-007)

## Project Structure

### Documentation (this feature)
```
specs/002-the-orders-backend/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
│   ├── post-orders.json              # Place order contract
│   ├── post-orders-preview.json      # Order preview contract
│   ├── delete-orders-id.json         # Cancel order contract
│   └── get-orders.json               # List orders contract
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)

**Web Application Structure** (Nx Monorepo):

```
apps/
├── api/
│   └── src/
│       └── order/
│           ├── order.entity.ts           # [EXTEND] Add order type fields
│           ├── order.service.ts          # [EXTEND] Add placeOrder, previewOrder, cancelOrder
│           ├── order.controller.ts       # [EXTEND] Add POST /orders, POST /orders/preview, DELETE /orders/:id
│           ├── dto/
│           │   ├── create-manual-order.dto.ts  # [NEW] DTO for order placement
│           │   ├── order-preview.dto.ts        # [NEW] DTO for preview response
│           │   └── order-filter.dto.ts         # [EXTEND] Add type filter
│           └── tasks/
│               └── order-sync.task.ts    # [EXISTING] Leverage for status updates
│
└── chansey/
    └── src/
        └── app/
            └── shared/
                ├── components/
                │   └── crypto-trading/
                │       ├── crypto-trading.component.ts    # [EXTEND] Add remaining order types
                │       └── crypto-trading.component.html  # [EXTEND] Add conditional fields
                └── services/
                    └── crypto-trading.service.ts  # [EXTEND] Uncomment/fix useCreateOrder, usePreviewOrder hooks

libs/
└── api-interfaces/
    └── src/
        └── lib/
            └── order.interface.ts        # [EXTEND] Add OrderType enum, ManualOrderParams

apps/api/src/migrations/
└── 1728XXXXXXX-AddManualOrderSupport.ts  # [NEW] Migration for order type fields

tests/
├── e2e/
│   └── cypress/
│       └── e2e/
│           └── trading/
│               ├── place-market-order.cy.ts   # [NEW] E2E test
│               └── place-limit-order.cy.ts    # [NEW] E2E test
└── integration/
    └── order-placement.spec.ts               # [NEW] API integration tests
```

**Structure Decision**: Web application structure with clear separation between backend (apps/api) and frontend (apps/chansey). All order-related logic co-located in the existing order module. Frontend uses existing crypto-trading component (`apps/chansey/src/app/shared/components/crypto-trading/`) which already has:
- Market and Limit order type support
- Stop Loss and Stop Limit UI (enhancedOrderTypeOptions lines 145-170)
- Order preview functionality (previewOrderMutation)
- Buy/sell forms with conditional validation
- Balance calculations and fee estimates

**Extends Rather Than Creates**: No new pages or components needed - extend existing crypto-trading component with remaining order types (Trailing Stop, Take-Profit, OCO) and connect to backend API.

## Phase 0: Outline & Research

**No research needed** - All technical decisions already made in clarifications:
1. ✅ Order types: Full suite (Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, OCO)
2. ✅ Price validation: No validation, warnings only
3. ✅ Exchange support: All user-connected exchanges via existing infrastructure
4. ✅ Status refresh: Manual + background sync via order-sync.task.ts
5. ✅ Concurrent capacity: 50 orders (10 max users)

**Research topics already resolved**:
- CCXT integration patterns: Already in use (apps/api/src/exchange/exchange-manager.service.ts)
- Order type parameter mapping: CCXT provides standardized interface for all order types
- Exchange-specific limits: CCXT exposes exchange.limits and exchange.markets metadata
- Balance validation: Existing balance service (apps/api/src/balance/balance.service.ts)
- Rate limiting: CCXT built-in enableRateLimit: true
- TypeORM entity extensions: Standard pattern for existing Order entity
- Angular conditional forms: PrimeNG dynamic form fields based on order type selection
- TanStack Query patterns: Already in use for other features

**Output**: research.md documenting existing infrastructure and confirming no additional research needed

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

### Data Model Extensions

**Order Entity Extensions** (extend existing apps/api/src/order/order.entity.ts):
- Add `isManual: boolean` (distinguish manual vs automated)
- Add `orderType: OrderTypeEnum` (market, limit, stop-loss, stop-limit, trailing-stop, take-profit, oco)
- Add `stopPrice?: number` (for stop orders)
- Add `trailingAmount?: number` (for trailing stop)
- Add `takeProfitPrice?: number` (for take-profit and OCO)
- Add `stopLossPrice?: number` (for OCO)

**DTOs to Create**:
- `CreateManualOrderDto`: Exchange selection, trading pair, order type, side, quantity, type-specific params
- `OrderPreviewResponseDto`: Estimated cost, fees breakdown, total, current market price
- Extend `OrderFilterDto`: Add `orderType` filter, `isManual` filter

### API Contracts

1. **POST /api/orders** - Place manual order
   - Request: CreateManualOrderDto
   - Response: Order entity with status
   - Validation: Balance check, exchange limits, parameter validation per order type
   - Error codes: 400 (validation), 402 (insufficient balance), 503 (exchange unavailable)

2. **POST /api/orders/preview** - Preview order without submission
   - Request: Same as CreateManualOrderDto
   - Response: OrderPreviewResponseDto
   - Validation: Same as placement but no balance lock
   - Performance: <2s response time

3. **DELETE /api/orders/:id** - Cancel open order
   - Request: Order ID in path
   - Response: Updated order entity (status = canceled)
   - Validation: Order must be open, user must own order
   - Error codes: 404 (not found), 409 (already filled)

4. **GET /api/orders** - List orders with filters (extend existing)
   - Add query params: `orderType`, `isManual`
   - Response: Paginated order list
   - Performance: Use indexed queries

### Contract Test Strategy

Generate failing contract tests in `tests/integration/`:
- `order-placement.contract.spec.ts`: Test POST /orders request/response schema
- `order-preview.contract.spec.ts`: Test POST /orders/preview schema
- `order-cancellation.contract.spec.ts`: Test DELETE /orders/:id schema
- Each test asserts: request DTO validation, response shape, error formats

### Integration Test Scenarios

From user stories:
1. **Place Market Buy Order** → Test: Submit market order, verify CCXT called, order persisted
2. **Place Limit Sell Order** → Test: Submit limit order, verify price/quantity validation
3. **Cancel Open Order** → Test: Cancel order, verify status updated, CCXT cancel called
4. **View Order History** → Test: Filter by type/status, verify pagination

### Quickstart Test

Manual validation steps (quickstart.md):
1. Connect to test exchange (Binance testnet)
2. Place market order for BTC/USDT (0.001 BTC)
3. Verify order appears in history with "manual" source
4. Place limit sell order above market price
5. Cancel limit order
6. Verify all orders synced correctly via order-sync.task.ts

### Agent File Update

Run `.specify/scripts/bash/update-agent-context.sh claude` to update CLAUDE.md with:
- New order placement endpoints
- Order type enum values
- Manual order placement workflow
- Order preview calculation logic

**Output**: data-model.md, /contracts/*, failing contract tests, quickstart.md, updated CLAUDE.md

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
1. Load `.specify/templates/tasks-template.md` as base
2. Generate tasks from Phase 1 design docs in this order:
   - **Database Tasks**: TypeORM migration for order entity extensions
   - **Backend Contract Tests**: 4 contract test files (failing initially)
   - **Backend DTOs**: CreateManualOrderDto, OrderPreviewResponseDto, extend OrderFilterDto
   - **Backend Service Logic**:
     - Order validation service methods (per order type)
     - Balance checking integration
     - CCXT order placement wrapper
     - Order preview calculation
     - Order cancellation logic
   - **Backend Controller**: 3 new endpoints + extend existing GET
   - **Shared Interfaces**: Update libs/api-interfaces with OrderType enum
   - **Frontend Service**: Add TanStack Query hooks (useCreateOrder, useOrderPreview, useCancelOrder)
   - **Frontend Components**:
     - OrderPlacementComponent (with conditional form logic)
     - OrderPreviewModalComponent
     - Extend OrderHistoryComponent
   - **Integration Tests**: Make contract tests pass
   - **E2E Tests**: 2 Cypress tests for primary scenarios
   - **Manual Validation**: Execute quickstart.md

**Ordering Strategy**:
- **TDD Order**: Contract tests → DTOs → Service → Controller → Integration tests pass
- **Dependency Order**:
  1. Migration (schema changes first)
  2. Shared interfaces (backend + frontend dependency)
  3. Backend (DTOs → Service → Controller)
  4. Frontend (Service hooks → Components)
  5. Tests (Contract → Integration → E2E)
- **Parallel Markers [P]**:
  - DTOs can be created in parallel
  - Frontend components can be built in parallel after service hooks exist
  - Contract test files can be created in parallel

**Estimated Output**: ~35-40 numbered, dependency-ordered tasks in tasks.md

**Task Breakdown**:
- Phase 0 (Migration): 1 task
- Phase 1 (Backend): 15-18 tasks (contracts, DTOs, validation, service, controller)
- Phase 2 (Shared): 2 tasks (interfaces, enums)
- Phase 3 (Frontend): 10-12 tasks (service hooks, components, routing)
- Phase 4 (Testing): 8-10 tasks (integration, E2E, manual validation)

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run tests, execute quickstart.md, load test 50 concurrent orders)

## Complexity Tracking
*No constitutional violations - all requirements align with established architecture*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A       | N/A        | N/A                                 |

**Justification**: This feature extends existing infrastructure (Order entity, CCXT integration, BullMQ sync task, Angular components) without introducing new architectural patterns. All complexity is inherent to the business requirements (7 order types, multi-exchange support, balance validation) and aligns with constitutional principles.

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - research.md created
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md, CLAUDE.md updated
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [x] Phase 3: Tasks generated (/tasks command) - tasks.md created with 38 tasks
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS (no new violations introduced)
- [x] All NEEDS CLARIFICATION resolved (5/5 clarifications in spec)
- [x] Complexity deviations documented (none - no violations)

**Execution Flow Status**:
1. ✅ Load feature spec from Input path
2. ✅ Fill Technical Context
3. ✅ Fill Constitution Check section
4. ✅ Evaluate Constitution Check section (PASS)
5. ✅ Execute Phase 0 → research.md
6. ✅ Execute Phase 1 → contracts, data-model.md, quickstart.md, CLAUDE.md
7. ✅ Re-evaluate Constitution Check section (PASS)
8. ✅ Plan Phase 2 → Described task generation approach
9. ✅ STOP - Ready for /tasks command

---
*Based on Constitution v1.0.2 - See `.specify/memory/constitution.md`*
