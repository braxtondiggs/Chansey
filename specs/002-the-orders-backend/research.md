# Phase 0: Research & Technical Decisions

**Feature**: Manual Order Placement System Overhaul
**Date**: 2025-10-08

## Research Summary

All technical decisions were resolved during the specification clarification phase. This document confirms existing infrastructure and validates no additional research is required.

## Decision Matrix

### 1. Order Types Support

**Decision**: Full suite (Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, OCO)

**Rationale**: Clarification Q1 determined maximum flexibility for professional traders

**Alternatives Considered**:
- Market + Limit only: Too limited for professional trading strategies
- Market + Limit + Stop-Loss: Missing comprehensive risk management tools
- Market + Limit + Stop-Loss + Stop-Limit: Missing trailing and OCO capabilities

**Implementation Notes**:
- CCXT supports all order types via standardized API
- Each exchange has different support levels (checked via `exchange.has['createOrder']` flags)
- Order-type-specific parameters mapped via CCXT's unified API
- Reference: https://docs.ccxt.com/#/?id=order-structure

### 2. Price Validation Strategy

**Decision**: No hard validation on price ranges; warnings only for extreme deviations (>50%)

**Rationale**: Clarification Q2 - professional traders need complete control

**Alternatives Considered**:
- ±10%: Too restrictive, blocks legitimate swing trading
- ±50%: Balanced but still constrains strategic orders
- ±90%: Permissive but adds minimal value

**Implementation Notes**:
- Display warning in UI when price deviates >50% from current market
- Do not block order submission
- Log warnings server-side for audit trail
- Example: "Warning: Limit price $100,000 is 150% above current market price $40,000"

### 3. Exchange Support

**Decision**: Support all user-connected exchanges (dynamic list)

**Rationale**: Clarification Q3 - leverage existing exchange key infrastructure

**Alternatives Considered**:
- Top 3 exchanges (Binance US, Coinbase, Kraken): Limits user choice
- Top 5 exchanges: Still requires hardcoded list
- All CCXT exchanges: Redundant since infrastructure already exists

**Existing Infrastructure**:
- Exchange keys stored in `apps/api/src/exchange-key/exchange-key.entity.ts`
- Exchange manager service: `apps/api/src/exchange/exchange-manager.service.ts`
- CCXT client factory: `apps/api/src/exchange/exchange-manager.service.ts:getClient()`
- Each exchange key linked to user and exchange type

**Implementation Notes**:
- Query user's connected exchanges from `exchange_key` table
- Instantiate CCXT client per exchange using stored API credentials
- Validate trading pair support via `exchange.markets[symbol]`
- Respect exchange-specific limits via `exchange.markets[symbol].limits`

### 4. Order Status Refresh Strategy

**Decision**: Manual refresh + background synchronization via existing order-sync.task.ts

**Rationale**: Clarification Q4 - minimize API consumption while maintaining data currency

**Alternatives Considered**:
- Real-time WebSocket: Complex, requires persistent connections per exchange
- 5-second polling: Excessive API usage, rate limit concerns
- 30-second polling: Still wasteful for infrequent status changes
- Hourly sync only: Too stale for active traders

**Existing Infrastructure**:
- Background sync task: `apps/api/src/order/tasks/order-sync.task.ts`
- Current schedule: Hourly (configurable via BullMQ cron)
- Syncs all user orders across all exchanges
- Updates order status, filled quantity, fees

**Implementation Notes**:
- Add manual refresh button to frontend (triggers API call)
- Manual refresh fetches order status via `exchange.fetchOrder(orderId)`
- Background sync continues on schedule (can be tuned if needed)
- No real-time polling required

### 5. Concurrent Capacity Planning

**Decision**: 50 concurrent order placements (supporting 10 max users)

**Rationale**: Clarification Q5 - small team of traders with controlled capacity

**Alternatives Considered**:
- 10 concurrent orders: Insufficient during high volatility (5 orders per user x 2 users)
- 100 concurrent orders: Over-provisioned for 10-user limit
- 500+ concurrent orders: Requires horizontal scaling, unnecessary complexity

**Infrastructure Sizing**:
- **Database**: PostgreSQL connection pool = 20 connections (2x max users)
- **API Server**: NestJS handles 50 concurrent requests without clustering
- **Redis**: BullMQ queue workers = 5 concurrent processors
- **CCXT Rate Limits**: Exchanges have per-API-key rate limits (CCXT handles automatically)

**Load Testing Targets**:
- 50 simultaneous POST /api/orders requests
- Response time: <3s p95 for order submission
- No failures due to connection pool exhaustion
- No rate limit violations

## Technology Stack Validation

### Backend Stack (NestJS)

**Existing Dependencies** (from package.json):
- `@nestjs/core`: 10.x ✅
- `@nestjs/typeorm`: Compatible with TypeORM 0.3.x ✅
- `typeorm`: 0.3.x ✅
- `ccxt`: 4.x ✅ (already in use for exchange integration)
- `class-validator`: Already in use for DTOs ✅
- `@nestjs/bull`: BullMQ integration ✅

**No New Dependencies Required**: All needed libraries already in use

### Frontend Stack (Angular)

**Existing Dependencies**:
- `@angular/core`: 19.x ✅
- `primeng`: 17.x ✅
- `@tanstack/angular-query-experimental`: Already in use ✅
- `rxjs`: 7.x ✅

**PrimeNG Components Needed** (all already available):
- `p-dropdown`: Exchange and trading pair selection ✅
- `p-inputNumber`: Quantity and price inputs ✅
- `p-button`: Action buttons ✅
- `p-dialog`: Order preview modal ✅
- `p-table`: Order history table ✅
- `p-message`: Warning messages ✅
- `p-toast`: Success/error notifications ✅

### Database Schema Extensions

**Existing Order Entity** (`apps/api/src/order/order.entity.ts`):
- Already has: `id`, `userId`, `exchangeKeyId`, `symbol`, `side`, `quantity`, `price`, `status`, `fee`, `filledQuantity`, `createdAt`, `updatedAt`
- **Extensions Needed**:
  - `isManual: boolean` (default: false for existing automated orders)
  - `orderType: enum` (market, limit, stop-loss, stop-limit, trailing-stop, take-profit, oco)
  - `stopPrice: decimal` (nullable)
  - `trailingAmount: decimal` (nullable)
  - `takeProfitPrice: decimal` (nullable)
  - `stopLossPrice: decimal` (nullable)

**Migration Strategy**:
- Add new columns with nullable constraints
- Set default `isManual = false` for existing records (preserves automated order history)
- Set default `orderType = 'market'` for existing records (safe assumption for historical data)
- Create indexes: `idx_orders_user_status`, `idx_orders_user_type`, `idx_orders_manual`

## Integration Patterns

### CCXT Order Placement Pattern

```typescript
// Existing pattern from exchange-manager.service.ts
const exchange = await this.getClient(user); // CCXT instance
const orderParams = {
  symbol: 'BTC/USDT',
  type: 'limit',  // market, limit, stop-loss, etc.
  side: 'buy',
  amount: 0.01,
  price: 50000,
  // Order-type-specific params
  stopPrice: 48000,  // for stop orders
  trailingAmount: 1000,  // for trailing stop
};
const result = await exchange.createOrder(
  orderParams.symbol,
  orderParams.type,
  orderParams.side,
  orderParams.amount,
  orderParams.price,
  orderParams  // Extra params passed through
);
```

**CCXT Response Structure**:
```json
{
  "id": "exchange-order-id",
  "symbol": "BTC/USDT",
  "type": "limit",
  "side": "buy",
  "price": 50000,
  "amount": 0.01,
  "filled": 0,
  "remaining": 0.01,
  "status": "open",
  "fee": { "cost": 0.5, "currency": "USDT" },
  "timestamp": 1728000000000
}
```

### Balance Validation Pattern

```typescript
// Existing pattern from balance.service.ts
const balances = await this.balanceService.getUserBalances(user);
const exchangeBalance = balances.current.find(e => e.id === exchangeKeyId);
const assetBalance = exchangeBalance.balances.find(b => b.asset === baseAsset);
const available = parseFloat(assetBalance.free);
const required = quantity * price + estimatedFee;
if (available < required) {
  throw new BadRequestException(`Insufficient balance: ${available} < ${required}`);
}
```

### Order Sync Pattern

**Existing Background Sync** (`apps/api/src/order/tasks/order-sync.task.ts`):
- Runs hourly via BullMQ cron
- Fetches all orders for each user's exchange keys
- Compares with database records
- Updates status/filled quantity for changed orders
- Inserts new orders (currently only automated orders)

**Extension Required**:
- Sync task should also update manually placed orders
- No code changes needed (sync fetches ALL orders from exchange)
- Manual orders will be synced automatically

## Best Practices Summary

### Backend Best Practices

1. **DTO Validation**: Use `class-validator` decorators for all order parameters
2. **Error Handling**: Wrap CCXT calls in try-catch, map to user-friendly errors
3. **Transaction Safety**: Persist order to DB before submitting to exchange (FR-006)
4. **Idempotency**: Check for duplicate order IDs before inserting
5. **Logging**: Log all order operations (placement, cancellation, status changes)
6. **Rate Limiting**: Trust CCXT's built-in rate limiting (`enableRateLimit: true`)

### Frontend Best Practices

1. **Form Validation**: Real-time validation with PrimeNG validators
2. **Conditional Fields**: Show/hide fields based on selected order type
3. **Preview Before Submit**: Always show preview modal (FR-004, FR-042)
4. **Optimistic Updates**: Use TanStack Query optimistic updates for instant feedback
5. **Error Display**: Toast notifications for errors, inline validation for fields
6. **Loading States**: Disable submit button during API calls

### Testing Best Practices

1. **Contract Tests**: Mock CCXT responses, test schema validation
2. **Integration Tests**: Use Binance testnet for actual exchange integration
3. **E2E Tests**: Mock exchange API responses (don't hit real exchanges in CI)
4. **Load Tests**: Use k6 or Artillery to simulate 50 concurrent orders
5. **Edge Case Coverage**: Test all 6 edge cases from spec

## Research Conclusion

**Status**: ✅ All research complete - no unknowns remain

**Key Findings**:
- All required infrastructure exists (CCXT, TypeORM, BullMQ, PrimeNG)
- No new dependencies required
- Existing patterns can be extended (no architectural changes)
- Performance targets achievable with current infrastructure
- Database schema extensions are minimal and backward-compatible

**Next Phase**: Proceed to Phase 1 (Design & Contracts)

---
*Research completed: 2025-10-08*
