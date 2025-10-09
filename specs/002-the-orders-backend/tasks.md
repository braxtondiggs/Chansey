# Tasks: Manual Order Placement System Overhaul

**Feature**: 002-the-orders-backend
**Branch**: `002-the-orders-backend`
**Input**: Design documents from `/specs/002-the-orders-backend/`
**Prerequisites**: plan.md, data-model.md, contracts/, quickstart.md, research.md

## Execution Flow (main)
```
1. ✅ Load plan.md → Tech stack: NestJS 10.x, Angular 19, TypeORM, CCXT, PrimeNG
2. ✅ Load data-model.md → Entities: Order (extend), DTOs: 3 new
3. ✅ Load contracts/ → 4 API endpoints (POST orders, POST preview, DELETE orders/:id, GET orders)
4. ✅ Load quickstart.md → 5 validation scenarios
5. ✅ Generate tasks by category:
   → Setup: migration, shared interfaces
   → Tests: 4 contract tests, 4 integration tests
   → Backend: 3 DTOs, service methods, 3 endpoints
   → Frontend: Service hooks, extend crypto-trading component
   → E2E: 3 Cypress tests
   → Polish: Manual validation
6. ✅ Apply task rules: Different files marked [P], same file sequential
7. ✅ Number tasks T001-T038
8. ✅ Validate: All contracts have tests, tests before implementation
9. SUCCESS - Tasks ready for execution
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- All file paths are absolute from repository root
- TDD approach: Tests MUST fail before implementation

---

## Phase 3.1: Setup & Database

### T001 - Create TypeORM migration for manual order support
**File**: `apps/api/src/migrations/[timestamp]-AddManualOrderSupport.ts`

Create TypeORM migration to extend the `orders` table with:
- Add column `is_manual` (boolean, default false)
- Add column `order_type` (enum: market, limit, stop_loss, stop_limit, trailing_stop, take_profit, oco, default 'market')
- Add column `stop_price` (decimal 20,8, nullable)
- Add column `trailing_amount` (decimal 20,8, nullable)
- Add column `trailing_type` (enum: amount, percentage, nullable)
- Add column `take_profit_price` (decimal 20,8, nullable)
- Add column `stop_loss_price` (decimal 20,8, nullable)
- Add column `oco_linked_order_id` (uuid, nullable)
- Create indexes:
  - `idx_orders_user_status` ON (user_id, status)
  - `idx_orders_user_type` ON (user_id, order_type)
  - `idx_orders_manual` ON (is_manual, user_id)
  - `idx_orders_exchange_key` ON (exchange_key_id, status)
- Add check constraint: `chk_manual_no_algorithm` to prevent isManual=true with algorithmActivationId
- Set defaults for existing records: isManual=false, orderType='market'

**Dependencies**: None
**Validation**: Run migration, verify schema changes, verify existing data unaffected

---

## Phase 3.2: Shared Interfaces (Backend + Frontend Dependency)

### T002 [P] - Add OrderType enum to api-interfaces
**File**: `libs/api-interfaces/src/lib/order.interface.ts`

Add OrderType enum and extend existing order interfaces:
```typescript
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop',
  TAKE_PROFIT = 'take_profit',
  OCO = 'oco'
}

export enum TrailingType {
  AMOUNT = 'amount',
  PERCENTAGE = 'percentage'
}

// Extend existing Order interface
export interface ManualOrderParams {
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}
```

**Dependencies**: None
**Validation**: TypeScript compiles, enum values match database schema

---

## Phase 3.3: Backend Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.4

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation in Phase 3.4**

### T003 [P] - Contract test POST /api/orders
**File**: `apps/api/test/order/order-placement.contract.spec.ts`

Create failing contract test for order placement endpoint:
- Test POST /api/orders with valid CreateManualOrderDto
- Test all 7 order types (market, limit, stop-loss, stop-limit, trailing-stop, take-profit, oco)
- Assert 201 response with order entity
- Test validation errors (400): missing fields, invalid orderType, negative quantity
- Test insufficient balance error (402)
- Test exchange unavailable error (503)
- Mock CCXT client responses
- DO NOT implement the endpoint yet - test should FAIL

**Dependencies**: T002 (OrderType enum)
**Expected**: Test fails with 404 (endpoint not found)

---

### T004 [P] - Contract test POST /api/orders/preview
**File**: `apps/api/test/order/order-preview.contract.spec.ts`

Create failing contract test for order preview endpoint:
- Test POST /api/orders/preview with same DTO as placement
- Assert 200 response with OrderPreviewResponseDto shape
- Verify response includes: estimatedCost, estimatedFee, estimatedTotal, currentMarketPrice, availableBalance, sufficientBalance, warnings[]
- Test validation errors (400)
- Test exchange unavailable (503)
- Mock exchange market price fetch
- DO NOT implement endpoint - test should FAIL

**Dependencies**: T002 (OrderType enum)
**Expected**: Test fails with 404 (endpoint not found)

---

### T005 [P] - Contract test DELETE /api/orders/:id
**File**: `apps/api/test/order/order-cancellation.contract.spec.ts`

Create failing contract test for order cancellation:
- Test DELETE /api/orders/{id} for authenticated user
- Assert 200 response with updated order (status = canceled)
- Test 403 error (user doesn't own order)
- Test 404 error (order not found)
- Test 409 error (order already filled)
- Test 409 error (order already canceled)
- Mock CCXT cancelOrder response
- DO NOT implement endpoint - test should FAIL

**Dependencies**: None
**Expected**: Test fails with 404 (endpoint not found)

---

### T006 [P] - Contract test GET /api/orders with new filters
**File**: `apps/api/test/order/order-list.contract.spec.ts`

Create contract test for extended GET /api/orders endpoint:
- Test existing endpoint with NEW query parameters: orderType, isManual
- Assert pagination meta: currentPage, itemsPerPage, totalItems, totalPages
- Test filtering by orderType (e.g., ?orderType=limit)
- Test filtering by isManual (e.g., ?isManual=true)
- Test combined filters (e.g., ?orderType=market&isManual=true&status=open)
- Verify response includes order.isManual field
- This extends EXISTING endpoint - may partially pass

**Dependencies**: T002 (OrderType enum)
**Expected**: Test may partially pass (endpoint exists but missing new filters)

---

### T007 [P] - Integration test: Place market buy order
**File**: `apps/api/test/order/integration/place-market-order.spec.ts`

Create end-to-end integration test for Scenario 1 (Place Market Buy Order):
- Setup: Create test user, mock exchange connection, seed balance
- Execute: POST /api/orders with market buy order
- Verify: CCXT createOrder called with correct params
- Verify: Order persisted with isManual=true, orderType='market'
- Verify: Order status is 'open' or 'filled'
- Verify: Balance updated (locked or deducted)
- Cleanup: Delete test data
- DO NOT implement service/controller - test should FAIL

**Dependencies**: T001 (migration), T002 (enums)
**Expected**: Test fails (no service/controller implementation)

---

### T008 [P] - Integration test: Place limit sell order with validation
**File**: `apps/api/test/order/integration/place-limit-order.spec.ts`

Create integration test for Scenario 2 (Place Limit Sell Order):
- Setup: Create test user, mock exchange, seed sell balance
- Execute: POST /api/orders with limit sell order
- Verify: Price validation (required for limit orders)
- Verify: Balance check (sufficient sell balance)
- Verify: Order placed with status='open' (limit orders don't fill immediately)
- Verify: Price stored correctly
- Test insufficient balance scenario (should return 402)
- DO NOT implement - test should FAIL

**Dependencies**: T001, T002
**Expected**: Test fails (no implementation)

---

### T009 [P] - Integration test: Cancel open order
**File**: `apps/api/test/order/integration/cancel-order.spec.ts`

Create integration test for Scenario 3 (Cancel Open Order):
- Setup: Create test user, create open limit order
- Execute: DELETE /api/orders/:id
- Verify: CCXT cancelOrder called
- Verify: Order status updated to 'canceled'
- Verify: Locked balance released
- Test edge cases:
  - Cannot cancel filled order (409)
  - Cannot cancel already-canceled order (409)
  - User can only cancel own orders (403)
- DO NOT implement - test should FAIL

**Dependencies**: T001, T002
**Expected**: Test fails (no cancellation logic)

---

### T010 [P] - Integration test: View order history with filters
**File**: `apps/api/test/order/integration/order-history.spec.ts`

Create integration test for Scenario 4 (View Order Status and History):
- Setup: Create test user, create multiple orders (manual + automated, various types)
- Execute: GET /api/orders with filters
- Test filter combinations:
  - ?isManual=true (only manual orders)
  - ?orderType=limit (only limit orders)
  - ?status=open&isManual=true (open manual orders)
- Verify pagination works
- Verify sorting (most recent first)
- Verify response includes isManual, orderType fields
- DO NOT implement filter logic - test should FAIL for new filters

**Dependencies**: T001, T002
**Expected**: Test partially fails (new filters not implemented)

---

## Phase 3.4: Backend Implementation (ONLY after tests are failing)

**GATE**: All tests in Phase 3.3 must exist and be failing before starting Phase 3.4

### T011 - Extend Order entity with manual order fields
**File**: `apps/api/src/order/order.entity.ts`

Extend existing Order entity to match migration schema:
```typescript
@Column({ name: 'is_manual', default: false })
isManual: boolean;

@Column({
  name: 'order_type',
  type: 'enum',
  enum: OrderType,
  default: OrderType.MARKET
})
orderType: OrderType;

@Column('decimal', { name: 'stop_price', precision: 20, scale: 8, nullable: true })
stopPrice?: number;

@Column('decimal', { name: 'trailing_amount', precision: 20, scale: 8, nullable: true })
trailingAmount?: number;

@Column({ name: 'trailing_type', type: 'enum', enum: TrailingType, nullable: true })
trailingType?: TrailingType;

@Column('decimal', { name: 'take_profit_price', precision: 20, scale: 8, nullable: true })
takeProfitPrice?: number;

@Column('decimal', { name: 'stop_loss_price', precision: 20, scale: 8, nullable: true })
stopLossPrice?: number;

@Column({ name: 'oco_linked_order_id', nullable: true })
ocoLinkedOrderId?: string;
```

**Dependencies**: T001 (migration), T002 (enums)
**Validation**: TypeScript compiles, entity matches database schema

---

### T012 [P] - Create CreateManualOrderDto
**File**: `apps/api/src/order/dto/create-manual-order.dto.ts`

Create DTO with class-validator decorators:
- exchangeKeyId (UUID, required)
- symbol (string, required)
- orderType (enum OrderType, required)
- side ('buy' | 'sell', required)
- quantity (number, positive, required)
- price (number, positive, required for limit/stop_limit)
- stopPrice (number, positive, required for stop_loss/stop_limit)
- trailingAmount (number, positive, required for trailing_stop)
- trailingType (enum TrailingType, required for trailing_stop)
- takeProfitPrice (number, positive, required for take_profit/oco)
- stopLossPrice (number, positive, required for oco)

Use @ValidateIf() for conditional validation based on orderType.

**Dependencies**: T002 (enums)
**Validation**: DTO validates correctly for all order types

---

### T013 [P] - Create OrderPreviewResponseDto
**File**: `apps/api/src/order/dto/order-preview.dto.ts`

Create response DTO:
```typescript
export class OrderPreviewResponseDto {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: OrderType;
  quantity: number;
  price: number | null;
  currentMarketPrice: number;
  estimatedCost: number;
  estimatedFee: number;
  estimatedTotal: number;
  availableBalance: number;
  requiredBalance: number;
  sufficientBalance: boolean;
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  warnings: string[];
  exchangeName: string;
  minOrderSize: number;
  maxOrderSize: number;
  pricePrecision: number;
  quantityPrecision: number;
}
```

**Dependencies**: T002 (enums)
**Validation**: DTO structure matches contract spec

---

### T014 - Extend OrderFilterDto with new filters
**File**: `apps/api/src/order/dto/order-filter.dto.ts`

Extend existing OrderFilterDto:
```typescript
@IsOptional()
@IsEnum(OrderType)
orderType?: OrderType;

@IsOptional()
@Type(() => Boolean)
@IsBoolean()
isManual?: boolean;

@IsOptional()
@Type(() => Date)
@IsDate()
startDate?: Date;

@IsOptional()
@Type(() => Date)
@IsDate()
endDate?: Date;
```

**Dependencies**: T002 (enums)
**Validation**: DTO extends existing without breaking changes

---

### T015 - Implement order preview logic in OrderService
**File**: `apps/api/src/order/order.service.ts`

Add `previewOrder()` method to OrderService:
- Accept CreateManualOrderDto
- Fetch exchange client via ExchangeManagerService
- Fetch current market price from exchange (cache 30s)
- Fetch user balance from BalanceService (cache 1min)
- Calculate estimatedCost: quantity * (price || marketPrice)
- Fetch exchange fee rate from CCXT exchange.fees
- Calculate estimatedFee: estimatedCost * feeRate
- Calculate estimatedTotal: estimatedCost + estimatedFee
- Check sufficientBalance: availableBalance >= estimatedTotal (for buy)
- Generate warnings:
  - Price >50% from market
  - Quantity > 10% of 24h volume
  - Insufficient balance
  - Order size below/above exchange limits
- Return OrderPreviewResponseDto
- Add JSDoc comments explaining calculation logic

**Dependencies**: T013 (OrderPreviewResponseDto)
**Validation**: T004 contract test passes

---

### T016 - Implement order validation logic in OrderService
**File**: `apps/api/src/order/order.service.ts`

Add `validateOrder()` private method:
- Validate exchange key belongs to user
- Validate trading pair exists on exchange via CCXT
- Validate min/max order size via exchange.markets[symbol].limits
- Validate price precision via exchange.markets[symbol].precision.price
- Validate quantity precision via exchange.markets[symbol].precision.amount
- Validate order-type-specific parameters:
  - Stop price must be below market for sell stop-loss
  - Stop price must be above market for buy stop-loss
  - OCO prices must be on opposite sides of market
- Check user balance (call BalanceService)
- Throw BadRequestException for validation failures
- Throw PaymentRequiredException (402) for insufficient balance

**Dependencies**: T015 (preview logic provides validation patterns)
**Validation**: T003, T007, T008 contract/integration tests pass validation scenarios

---

### T017 - Implement placeOrder logic in OrderService
**File**: `apps/api/src/order/order.service.ts`

Add `placeOrder()` method to OrderService:
- Validate order using validateOrder() method
- Persist order to database with status='new', isManual=true
- Get CCXT exchange client via ExchangeManagerService
- Map DTO to CCXT order params based on orderType:
  - Market: {type: 'market'}
  - Limit: {type: 'limit', price}
  - Stop Loss: {type: 'stop_loss', stopPrice}
  - Stop Limit: {type: 'stop_limit', price, stopPrice}
  - Trailing Stop: {type: 'trailing_stop', trailingAmount, trailingType}
  - Take Profit: {type: 'take_profit', takeProfitPrice}
  - OCO: Create TWO orders (take-profit + stop-loss) and link via ocoLinkedOrderId
- Call exchange.createOrder() via CCXT
- Update order with exchangeOrderId and status from CCXT response
- Handle errors:
  - Catch CCXT errors, map to user-friendly messages
  - If exchange fails, keep order status='new' (don't mark as failed yet)
  - Log errors for troubleshooting
- Return updated order entity
- Add JSDoc comments explaining CCXT integration

**Dependencies**: T016 (validation), T011 (entity)
**Validation**: T003, T007, T008 contract/integration tests pass

---

### T018 - Implement cancelOrder logic in OrderService
**File**: `apps/api/src/order/order.service.ts`

Add `cancelOrder()` method to OrderService:
- Fetch order by ID with user ownership check
- Validate order status (must be 'open' or 'partially_filled')
- Throw 409 ConflictException if order is 'filled', 'canceled', or 'rejected'
- Get CCXT exchange client
- Call exchange.cancelOrder(exchangeOrderId) via CCXT
- Update order status to 'canceled'
- If OCO order, also cancel linked order
- Handle errors:
  - Order filled before cancel: return 409 with message
  - Exchange unavailable: return 503, do NOT update local status
- Return updated order entity

**Dependencies**: T011 (entity)
**Validation**: T005, T009 tests pass

---

### T019 - Extend getOrders to support new filters
**File**: `apps/api/src/order/order.service.ts`

Modify existing `getOrders()` method:
- Accept OrderFilterDto with new fields (orderType, isManual, startDate, endDate)
- Build TypeORM query with new WHERE conditions:
  - `order.orderType = :orderType` (if provided)
  - `order.isManual = :isManual` (if provided)
  - `order.createdAt >= :startDate` (if provided)
  - `order.createdAt <= :endDate` (if provided)
- Ensure indexes are used (idx_orders_user_type, idx_orders_manual)
- Eager load exchange and algorithmActivation relationships
- Return paginated results
- Preserve existing filter functionality (exchangeKeyId, status, symbol)

**Dependencies**: T014 (OrderFilterDto)
**Validation**: T006, T010 tests pass

---

### T020 - Add POST /api/orders endpoint to OrderController
**File**: `apps/api/src/order/order.controller.ts`

Add endpoint:
```typescript
@Post()
@ApiOperation({ summary: 'Place manual order', description: '...' })
@ApiResponse({ status: 201, type: Order })
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 402, description: 'Insufficient balance' })
@ApiResponse({ status: 503, description: 'Exchange unavailable' })
async placeOrder(
  @GetUser() user: User,
  @Body() dto: CreateManualOrderDto
): Promise<Order> {
  return this.orderService.placeOrder(user, dto);
}
```

**Dependencies**: T017 (placeOrder service method), T012 (CreateManualOrderDto)
**Validation**: T003, T007, T008 tests pass

---

### T021 - Add POST /api/orders/preview endpoint to OrderController
**File**: `apps/api/src/order/order.controller.ts`

Add endpoint:
```typescript
@Post('preview')
@ApiOperation({ summary: 'Preview order cost', description: '...' })
@ApiResponse({ status: 200, type: OrderPreviewResponseDto })
async previewOrder(
  @GetUser() user: User,
  @Body() dto: CreateManualOrderDto
): Promise<OrderPreviewResponseDto> {
  return this.orderService.previewOrder(user, dto);
}
```

**Dependencies**: T015 (previewOrder service method), T013 (OrderPreviewResponseDto)
**Validation**: T004 test passes

---

### T022 - Add DELETE /api/orders/:id endpoint to OrderController
**File**: `apps/api/src/order/order.controller.ts`

Add endpoint:
```typescript
@Delete(':id')
@ApiOperation({ summary: 'Cancel open order', description: '...' })
@ApiResponse({ status: 200, type: Order })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 404, description: 'Order not found' })
@ApiResponse({ status: 409, description: 'Order already filled/canceled' })
async cancelOrder(
  @GetUser() user: User,
  @Param('id') orderId: string
): Promise<Order> {
  return this.orderService.cancelOrder(user, orderId);
}
```

**Dependencies**: T018 (cancelOrder service method)
**Validation**: T005, T009 tests pass

---

### T023 - Update GET /api/orders to return new filters
**File**: `apps/api/src/order/order.controller.ts`

Extend existing GET endpoint:
- Add @ApiQuery decorators for orderType, isManual, startDate, endDate
- Pass OrderFilterDto to service (already extended in T014)
- Update @ApiResponse to document new fields in response

**Dependencies**: T019 (service filter logic)
**Validation**: T006, T010 tests pass

---

## Phase 3.5: Frontend Implementation

### T024 - Extend crypto-trading.service.ts with order placement hooks
**File**: `apps/chansey/src/app/shared/services/crypto-trading.service.ts`

Implement/uncomment TanStack Query hooks:
- `useCreateOrder()`: POST /api/orders mutation
  - Optimistic update: Immediately add order to local cache
  - On success: Invalidate orders query, show toast notification
  - On error: Rollback optimistic update, show error toast
- `usePreviewOrder()`: POST /api/orders/preview mutation
  - Debounce: 500ms to avoid excessive API calls
  - Cache preview results for 30s
  - On error: Return null, log to console
- `useCancelOrder()`: DELETE /api/orders/:id mutation
  - Optimistic update: Mark order as 'canceled' in cache
  - On success: Invalidate orders query
  - On error: Rollback, show error toast

**Dependencies**: T020, T021, T022 (backend endpoints)
**Validation**: Service compiles, hooks return correct types

---

### T025 - Add remaining order types to crypto-trading component
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`

Extend enhancedOrderTypeOptions array (currently has Market, Limit, Stop Loss, Stop Limit):
```typescript
{
  label: 'Trailing Stop',
  value: OrderType.TRAILING_STOP,
  icon: 'pi pi-chart-line',
  description: 'Stop order that trails the market price'
},
{
  label: 'Take Profit',
  value: OrderType.TAKE_PROFIT,
  icon: 'pi pi-check-circle',
  description: 'Automatically sell when price reaches target'
},
{
  label: 'OCO',
  value: OrderType.OCO,
  icon: 'pi pi-arrows-h',
  description: 'One-Cancels-Other: take-profit + stop-loss pair'
}
```

**Dependencies**: T002 (OrderType enum)
**Validation**: Component compiles, dropdown shows all 7 order types

---

### T026 - Add conditional form fields for new order types
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`

Extend form subscriptions in setupFormSubscriptions():
- For Trailing Stop: Show trailingAmount and trailingType fields
  - Add validators: trailingAmount (required, min 0.001)
  - Add validators: trailingType (required, enum)
  - Add form controls to buyOrderForm and sellOrderForm
- For Take Profit: Show takeProfitPrice field
  - Add validators: takeProfitPrice (required, min 0.001)
- For OCO: Show both takeProfitPrice AND stopLossPrice fields
  - Add validators for both (required, min 0.001)
  - Add cross-field validation: prices must be on opposite sides of market

**Dependencies**: T025 (order type options)
**Validation**: Forms validate correctly for each order type

---

### T027 - Update crypto-trading component template with conditional fields
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`

Add conditional form fields using *ngIf:
```html
<!-- Trailing Stop fields -->
<div *ngIf="buyOrderForm.get('type')?.value === 'trailing_stop'">
  <p-inputNumber formControlName="trailingAmount" [label]="'Trail Amount'"/>
  <p-select formControlName="trailingType" [options]="[{label: 'Amount', value: 'amount'}, {label: 'Percentage', value: 'percentage'}]"/>
</div>

<!-- Take Profit field -->
<div *ngIf="buyOrderForm.get('type')?.value === 'take_profit' || buyOrderForm.get('type')?.value === 'oco'">
  <p-inputNumber formControlName="takeProfitPrice" [label]="'Take Profit Price'"/>
</div>

<!-- OCO stop loss field -->
<div *ngIf="buyOrderForm.get('type')?.value === 'oco'">
  <p-inputNumber formControlName="stopLossPrice" [label]="'Stop Loss Price'"/>
</div>
```

Repeat for sell order form.

**Dependencies**: T026 (form fields added to component)
**Validation**: UI shows/hides fields correctly based on order type selection

---

### T028 - Uncomment and fix order submission in crypto-trading component
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`

Fix onSubmitOrder() method (currently commented lines 339-355):
- Map form values to CreateManualOrderDto
- Include order-type-specific fields (stopPrice, trailingAmount, etc.)
- Call `this.createOrderMutation.mutate(orderData)`
- On success: Reset form, show toast
- On error: Show error toast with specific message

**Dependencies**: T024 (useCreateOrder hook)
**Validation**: Order submission works, form resets, toasts appear

---

### T029 - Wire up order preview to preview mutation
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`

Update calculateOrderTotalWithPreview() method:
- Call `this.previewOrderMutation.mutate(orderData)` (already exists)
- Ensure all order-type-specific fields are included in orderData
- Handle loading state (show spinner during preview)
- Handle error state (show warning, allow submission anyway)
- Update buyOrderPreview/sellOrderPreview signals with result

**Dependencies**: T024 (usePreviewOrder hook)
**Validation**: Preview updates correctly for all order types

---

### T030 - Add order type column to order history table
**File**: `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`

Extend order history p-table:
- Add column: Order Type (display order.orderType with badge styling)
- Add column: Source (display "Manual" or "Algorithm" based on order.isManual)
- Add filter dropdown for Order Type (Market, Limit, Stop Loss, etc.)
- Add filter toggle for Source (Manual/Automated)
- Ensure table shows new order entity fields (stopPrice, etc.) in order details

**Dependencies**: None (extends existing table)
**Validation**: Table displays new columns, filters work

---

## Phase 3.6: End-to-End Tests

### T031 [P] - E2E test: Place market order flow
**File**: `apps/chansey-e2e/src/e2e/trading/place-market-order.cy.ts`

Create Cypress E2E test:
- Setup: Seed test user, exchange connection
- Navigate to /trading page
- Select exchange from dropdown
- Select BTC/USDT pair
- Select "Market" order type
- Enter quantity: 0.001
- Click "Place Order"
- Verify preview modal appears with cost breakdown
- Click "Confirm" in modal
- Verify success toast appears
- Verify order appears in order history table with:
  - Type: "Market"
  - Source: "Manual"
  - Status: "Filled" or "Open"

**Dependencies**: T028 (order submission), T030 (order history)
**Validation**: E2E test passes end-to-end

---

### T032 [P] - E2E test: Place limit order with preview
**File**: `apps/chansey-e2e/src/e2e/trading/place-limit-order.cy.ts`

Create Cypress E2E test:
- Setup: Seed test user, exchange
- Navigate to trading page
- Select exchange and pair
- Select "Limit" order type
- Enter quantity and limit price (above market for sell)
- Verify preview updates automatically
- Verify preview shows warning "Price is X% above market"
- Click "Place Order"
- Confirm in modal
- Verify order appears with Status: "Open"
- Test cancellation: Click "Cancel" button on order row
- Verify order status updates to "Canceled"

**Dependencies**: T028, T029 (preview), T030
**Validation**: E2E test passes, preview works, cancellation works

---

### T033 [P] - E2E test: OCO order placement
**File**: `apps/chansey-e2e/src/e2e/trading/place-oco-order.cy.ts`

Create Cypress E2E test:
- Navigate to trading page
- Select "OCO" order type
- Verify both takeProfitPrice and stopLossPrice fields appear
- Enter quantity, take-profit price (above market), stop-loss price (below market)
- Verify preview calculates correctly
- Submit order
- Verify TWO orders appear in history (linked by ocoLinkedOrderId)
- Verify when one order fills, the other is canceled

**Dependencies**: T027 (OCO conditional fields), T028
**Validation**: E2E test passes, OCO linking works

---

## Phase 3.7: Polish & Validation

### T034 [P] - Unit tests for order validation logic
**File**: `apps/api/test/order/unit/order-validation.spec.ts`

Create unit tests for OrderService.validateOrder():
- Test exchange key ownership validation
- Test trading pair existence validation
- Test min/max order size validation
- Test price precision validation
- Test quantity precision validation
- Test order-type-specific validations:
  - Stop price direction for buy/sell
  - OCO price positioning
  - Trailing stop parameters
- Test balance validation (mock BalanceService)
- Mock CCXT exchange.markets responses

**Dependencies**: T016 (validation logic)
**Validation**: Unit tests pass, 80%+ coverage on validation logic

---

### T035 [P] - Unit tests for order preview calculation
**File**: `apps/api/test/order/unit/order-preview.spec.ts`

Create unit tests for OrderService.previewOrder():
- Test cost calculation (quantity * price)
- Test fee calculation (exchange fee rates)
- Test balance check logic
- Test warning generation:
  - Price deviation >50%
  - Order size > 10% volume
  - Insufficient balance
  - Order size below/above limits
- Mock exchange market price fetch
- Mock balance service responses

**Dependencies**: T015 (preview logic)
**Validation**: Unit tests pass, 80%+ coverage

---

### T036 - Run database migration on dev environment
**File**: N/A (command execution)

Execute migration:
```bash
cd apps/api
npm run migration:run
```

Verify:
- All columns added to orders table
- Indexes created
- Existing data migrated correctly (isManual=false, orderType='market')
- Check constraints in place

**Dependencies**: T001 (migration file)
**Validation**: Migration runs without errors, schema verified

---

### T037 - Execute manual validation scenarios from quickstart.md
**File**: `/specs/002-the-orders-backend/quickstart.md`

Manually execute all 5 scenarios:
1. Place Market Buy Order (Scenario 1)
2. Place Limit Sell Order (Scenario 2)
3. Cancel Open Order (Scenario 3)
4. Stop-Loss Order Placement (Scenario 4)
5. View Order Status and History (Scenario 5)

Execute 4 edge cases:
1. Insufficient Balance
2. Invalid Trading Pair
3. Exchange Connection Failure
4. Price Deviation Warning

Validate background sync:
- Trigger order-sync.task.ts manually via BullMQ
- Verify order status updates from exchange

Document results in quickstart.md (checklist completion).

**Dependencies**: All implementation tasks complete
**Validation**: All scenarios pass, edge cases handled correctly

---

### T038 - Performance test: 50 concurrent order placements
**File**: N/A (Artillery/k6 script)

Create and run load test:
```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 10
      arrivalRate: 5  # 50 orders over 10 seconds
scenarios:
  - name: "Place Market Orders"
    flow:
      - post:
          url: "/api/orders"
          json:
            exchangeKeyId: "{{exchangeKeyId}}"
            symbol: "BTC/USDT"
            orderType: "market"
            side: "buy"
            quantity: 0.0001
```

Verify:
- 0% failure rate
- p95 response time < 3 seconds
- No database connection pool exhaustion
- No rate limit violations

**Dependencies**: T020 (POST /api/orders endpoint)
**Validation**: Performance targets met (NFR-004: 50 concurrent orders)

---

## Dependencies Summary

### Critical Path:
1. T001 (Migration) → All backend tasks
2. T002 (Enums) → All backend and frontend tasks
3. T003-T010 (Tests) → T011-T023 (Implementation)
4. T011-T023 (Backend) → T024-T030 (Frontend)
5. T024-T030 (Frontend) → T031-T033 (E2E)
6. All implementation → T034-T038 (Polish)

### Parallel Execution Opportunities:
- **Phase 3.2**: T002 (single task, no parallelization)
- **Phase 3.3**: T003, T004, T005, T006, T007, T008, T009, T010 (8 tests in parallel)
- **Phase 3.4**: T012, T013 (2 DTOs in parallel)
- **Phase 3.6**: T031, T032, T033 (3 E2E tests in parallel)
- **Phase 3.7**: T034, T035 (2 unit test suites in parallel)

### Blocking Relationships:
- T001 blocks all backend tasks (migration must run first)
- T011 blocks T015, T016, T017, T018, T019 (entity must exist before service methods)
- T015, T016, T017, T018, T019 block T020, T021, T022, T023 (service methods before controller)
- T020, T021, T022 block T024 (backend endpoints before frontend hooks)
- T024 blocks T028, T029 (hooks before component usage)

---

## Parallel Execution Example

```bash
# Launch Phase 3.3 tests in parallel (8 concurrent tasks):
# These tests MUST fail initially (TDD)

# Terminal 1:
Task: "Contract test POST /api/orders in apps/api/test/order/order-placement.contract.spec.ts"

# Terminal 2:
Task: "Contract test POST /api/orders/preview in apps/api/test/order/order-preview.contract.spec.ts"

# Terminal 3:
Task: "Contract test DELETE /api/orders/:id in apps/api/test/order/order-cancellation.contract.spec.ts"

# Terminal 4:
Task: "Contract test GET /api/orders with filters in apps/api/test/order/order-list.contract.spec.ts"

# Terminal 5:
Task: "Integration test place market buy order in apps/api/test/order/integration/place-market-order.spec.ts"

# Terminal 6:
Task: "Integration test place limit sell order in apps/api/test/order/integration/place-limit-order.spec.ts"

# Terminal 7:
Task: "Integration test cancel open order in apps/api/test/order/integration/cancel-order.spec.ts"

# Terminal 8:
Task: "Integration test view order history in apps/api/test/order/integration/order-history.spec.ts"
```

---

## Validation Checklist

**GATE: All must be true before marking tasks.md complete**

- [x] All contracts (4) have corresponding tests (T003-T006)
- [x] All entities (1 Order extension) have model task (T011)
- [x] All tests (T003-T010) come before implementation (T011-T023)
- [x] Parallel tasks [P] truly independent (different files, verified)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] TDD enforced: Phase 3.3 (tests) before Phase 3.4 (implementation)
- [x] All 7 order types covered: Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, OCO
- [x] All 4 API endpoints have implementation tasks
- [x] Integration scenarios from quickstart.md covered
- [x] Performance test for 50 concurrent orders (NFR-004)
- [x] Manual validation scenario task (T037)

---

## Notes

- **TDD Critical**: Tests in Phase 3.3 MUST be written and failing before any implementation in Phase 3.4
- **Brownfield**: All tasks extend existing files - no new modules or components created
- **Existing Component**: crypto-trading.component.ts already has Market, Limit, Stop Loss, Stop Limit - only adding 3 more types
- **CCXT Integration**: Leverage existing ExchangeManagerService patterns
- **Order Sync**: Existing order-sync.task.ts automatically handles manual orders - no changes needed
- **Commit Strategy**: Commit after each task completion
- **Migration First**: T001 must complete before backend work begins
- **Test Coverage Target**: 80%+ for service logic (T034-T035)

---

## Task Execution Status

**Total Tasks**: 38
**Completed**: 0
**In Progress**: 0
**Blocked**: 0
**Ready**: T001, T002 (after migration runs, all T003-T010 become ready)

---

*Tasks generated: 2025-10-08*
*Based on plan.md v1.0, data-model.md, contracts/ (4 files), quickstart.md*
