# Quickstart: Manual Order Placement Validation

**Feature**: Manual Order Placement System Overhaul
**Date**: 2025-10-08
**Purpose**: Manual end-to-end validation of order placement functionality

## Prerequisites

### Environment Setup

1. **Database**: PostgreSQL running with migrations applied
   ```bash
   npm run migration:run
   ```

2. **Redis**: Redis server running for BullMQ and caching
   ```bash
   redis-server
   ```

3. **API Server**: NestJS API server running
   ```bash
   npm run api
   ```

4. **Frontend**: Angular frontend running
   ```bash
   npm run site
   ```

### Test Exchange Setup

**Option 1: Binance Testnet** (Recommended)
- Create account at: https://testnet.binance.vision/
- Generate API keys with trading permissions
- Fund testnet account with test USDT and BTC

**Option 2: Coinbase Sandbox**
- Create sandbox account at: https://public.sandbox.pro.coinbase.com/
- Generate API keys
- Sandbox has pre-funded accounts

### User Account Setup

1. Register test user account in the application
2. Navigate to Exchange Keys settings
3. Add testnet exchange connection:
   - Exchange: Binance Testnet (or Coinbase Sandbox)
   - API Key: [your testnet API key]
   - API Secret: [your testnet API secret]
4. Verify connection shows "Connected" status

## Validation Scenarios

### Scenario 1: Place Market Buy Order

**Acceptance Criteria**: FR-001, FR-014, FR-018, FR-022, FR-026, FR-043

**Steps**:
1. Navigate to Trading → Place Order page
2. Select Exchange: "Binance Testnet"
3. Select Trading Pair: "BTC/USDT"
4. Select Order Type: "Market"
5. Select Side: "Buy"
6. Enter Quantity: 0.001 (BTC)
7. Click "Place Order" button

**Expected Results**:
- ✅ Order preview modal appears showing:
  - Estimated cost based on current market price
  - Fee breakdown
  - Total required balance
  - "Sufficient balance" indicator
- ✅ Click "Confirm" in preview modal
- ✅ Success toast notification appears
- ✅ Order appears in Order History with:
  - Status: "filled" or "open"
  - Source: "Manual" (not "Algorithm")
  - Order Type: "Market"
  - Filled Quantity: >0 (for filled orders)
- ✅ Order syncs to database with `isManual = true`

**Verification Queries**:
```sql
-- Check order was created
SELECT id, symbol, order_type, side, quantity, status, is_manual, created_at
FROM orders
WHERE user_id = '[test-user-id]'
  AND symbol = 'BTC/USDT'
  AND is_manual = true
ORDER BY created_at DESC
LIMIT 1;

-- Verify no algorithm activation linked
SELECT algorithm_activation_id FROM orders WHERE id = '[order-id]';
-- Should return NULL
```

---

### Scenario 2: Place Limit Sell Order

**Acceptance Criteria**: FR-002, FR-004, FR-012, FR-015, FR-042

**Steps**:
1. Navigate to Trading → Place Order page
2. Select Exchange: "Binance Testnet"
3. Select Trading Pair: "BTC/USDT"
4. Select Order Type: "Limit"
5. Select Side: "Sell"
6. Enter Quantity: 0.001 (BTC)
7. Enter Limit Price: [Current Market Price + 10%] (e.g., if BTC is $50,000, enter $55,000)
8. Click "Place Order"

**Expected Results**:
- ✅ Order preview shows:
  - Estimated total: quantity × limit price
  - Fee calculation
  - Warning: "Limit price is X% above current market price" (if applicable)
  - Available BTC balance
  - "Sufficient balance: Yes" (assuming you have 0.001 BTC)
- ✅ Click "Confirm"
- ✅ Success notification
- ✅ Order appears in history with:
  - Status: "open" (limit order waiting for price)
  - Order Type: "Limit"
  - Price: The limit price you entered
  - Source: "Manual"

**Verification**:
```sql
SELECT id, order_type, side, quantity, price, status, is_manual
FROM orders
WHERE user_id = '[test-user-id]'
  AND symbol = 'BTC/USDT'
  AND order_type = 'limit'
  AND is_manual = true
ORDER BY created_at DESC
LIMIT 1;
```

---

### Scenario 3: Cancel Open Order

**Acceptance Criteria**: FR-019, FR-020, FR-021, FR-022

**Steps**:
1. Using the limit order created in Scenario 2
2. Navigate to Order History
3. Find the open limit order
4. Click "Cancel" button on the order row
5. Confirm cancellation in dialog

**Expected Results**:
- ✅ Cancellation request sent to exchange
- ✅ Success notification: "Order canceled successfully"
- ✅ Order status updates to "Canceled" in the table
- ✅ Order no longer appears in "Open Orders" filter
- ✅ Locked BTC balance released back to available

**Verification**:
```sql
-- Check order status updated
SELECT id, status, updated_at
FROM orders
WHERE id = '[limit-order-id]';
-- status should be 'canceled'

-- Check exchange order ID recorded
SELECT exchange_order_id FROM orders WHERE id = '[limit-order-id]';
-- Should have exchange's order ID
```

**Exchange Verification**:
- Log into Binance Testnet web interface
- Navigate to Open Orders
- Verify the order is no longer listed (it was canceled)

---

### Scenario 4: Stop-Loss Order Placement

**Acceptance Criteria**: FR-002, FR-002b, FR-013

**Steps**:
1. Navigate to Trading → Place Order
2. Select Exchange: "Binance Testnet"
3. Select Trading Pair: "BTC/USDT"
4. Select Order Type: "Stop Loss"
5. Select Side: "Sell"
6. Enter Quantity: 0.001
7. Enter Stop Price: [Current Market Price - 5%] (e.g., if BTC is $50,000, enter $47,500)
8. Click "Place Order"

**Expected Results**:
- ✅ Order preview shows:
  - Stop price parameter
  - Warning if stop price is unusual
  - Estimated execution when triggered
- ✅ Order places successfully
- ✅ Order appears with Order Type: "Stop Loss"
- ✅ Database record includes `stop_price` field populated

**Verification**:
```sql
SELECT id, order_type, side, quantity, stop_price, status
FROM orders
WHERE user_id = '[test-user-id]'
  AND order_type = 'stop_loss'
  AND is_manual = true
ORDER BY created_at DESC
LIMIT 1;
-- stop_price should be populated
```

---

### Scenario 5: View Order Status and History

**Acceptance Criteria**: FR-023, FR-024, FR-025, FR-027

**Steps**:
1. Navigate to Order History page
2. Observe default order list (all orders, sorted by newest first)
3. Apply filter: Order Type = "Limit"
4. Apply filter: Status = "Open"
5. Apply filter: Source = "Manual"
6. Clear filters
7. Apply date range filter: Last 7 days
8. Change pagination: Show 50 items per page

**Expected Results**:
- ✅ Default view shows all orders sorted by created_at DESC
- ✅ Each order row displays:
  - Trading pair
  - Side (Buy/Sell)
  - Order type
  - Quantity
  - Price (if applicable)
  - Status
  - Source (Manual/Algorithm)
  - Fees
  - Created timestamp
  - Actions (Cancel button for open orders)
- ✅ Filters work correctly:
  - Order Type filter shows only selected types
  - Status filter shows only selected status
  - Source filter distinguishes manual vs automated
  - Date range filter restricts results
- ✅ Pagination controls visible
- ✅ Page size selector works (20, 50, 100 options)

**Verification**:
```sql
-- Test query matching frontend filter logic
SELECT COUNT(*) FROM orders
WHERE user_id = '[test-user-id]'
  AND order_type = 'limit'
  AND status = 'open'
  AND is_manual = true;
-- Should match frontend count
```

---

## Edge Case Testing

### Edge Case 1: Insufficient Balance

**Steps**:
1. Place Order → Market Buy
2. Enter quantity that exceeds available balance (e.g., 100 BTC when you have 0.001 BTC worth in USDT)
3. Click "Place Order"

**Expected**:
- ✅ Order preview shows "Insufficient balance: false"
- ✅ Error message: "Insufficient balance. You have $X but need $Y including fees"
- ✅ "Confirm" button disabled or shows error on click
- ✅ Order NOT submitted to exchange
- ✅ No database record created

---

### Edge Case 2: Invalid Trading Pair

**Steps**:
1. Attempt to select a trading pair not supported by exchange
2. (Or manually craft API request with invalid symbol like "BTC/XYZ")

**Expected**:
- ✅ UI only shows valid trading pairs for selected exchange
- ✅ If manually crafted API call: 422 error response
- ✅ Error message: "Trading pair {symbol} is not supported on this exchange"

---

### Edge Case 3: Exchange Connection Failure

**Steps**:
1. Disconnect from internet or block exchange API access
2. Attempt to place order

**Expected**:
- ✅ Error message: "Exchange API is currently unavailable. Please try again later."
- ✅ 503 Service Unavailable response
- ✅ No partial order created in database
- ✅ User can retry after connection restored

---

### Edge Case 4: Price Deviation Warning

**Steps**:
1. Place Limit Order
2. Set price 60% above current market (if buying) or 60% below (if selling)
3. View preview

**Expected**:
- ✅ Warning message: "Limit price $X is Y% above/below current market price $Z"
- ✅ Order still allowed to proceed (FR-013: warnings only, not validation)
- ✅ User can confirm despite warning

---

## Background Sync Validation

**Acceptance Criteria**: FR-021, NFR-003

### Test Order Sync Task

**Steps**:
1. Place a limit order via frontend (as in Scenario 2)
2. Manually fill or cancel the order directly on Binance Testnet web interface
3. Wait for next order sync cycle (hourly, or trigger manually via BullMQ dashboard)
4. Check order status in frontend

**Expected**:
- ✅ Order status updates to "filled" or "canceled" after sync
- ✅ Filled quantity updated if partially filled
- ✅ Fee information populated from exchange
- ✅ Frontend shows updated status after page refresh

**Manual Trigger** (optional):
```bash
# Access BullMQ dashboard at /api/admin/queues
# Find order-sync queue
# Click "Add Job" to manually trigger sync
```

**Verification**:
```sql
-- Check sync updated the order
SELECT id, status, filled_quantity, fee, updated_at
FROM orders
WHERE exchange_order_id = '[exchange-order-id]';
-- status and filled_quantity should reflect exchange state
```

---

## Performance Validation

### Test Concurrent Order Placement

**Acceptance Criteria**: NFR-004 (50 concurrent orders)

**Load Test Script** (using Artillery or k6):
```yaml
# artillery-load-test.yml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 10
      arrivalRate: 5  # 5 orders/sec = 50 total over 10 seconds
  processor: "./auth-processor.js"

scenarios:
  - name: "Place Market Orders"
    flow:
      - post:
          url: "/api/orders"
          headers:
            Authorization: "Bearer {{ token }}"
          json:
            exchangeKeyId: "{{ exchangeKeyId }}"
            symbol: "BTC/USDT"
            orderType: "market"
            side: "buy"
            quantity: 0.0001
```

**Expected**:
- ✅ All 50 orders process successfully (0% failure rate)
- ✅ p95 response time < 3 seconds (NFR-002)
- ✅ No database connection pool exhaustion errors
- ✅ No rate limit violations on exchange API

---

## Manual Validation Checklist

### Database Integrity

- [ ] Migration applied successfully (new columns exist)
- [ ] Indexes created (`idx_orders_user_status`, `idx_orders_user_type`, `idx_orders_manual`)
- [ ] Check constraints enforce order type parameter requirements
- [ ] Manual orders have `is_manual = true`
- [ ] Manual orders have `algorithm_activation_id = NULL`

### API Endpoints

- [ ] POST /api/orders creates orders successfully
- [ ] POST /api/orders/preview returns cost estimates
- [ ] DELETE /api/orders/:id cancels open orders
- [ ] GET /api/orders filters by `orderType` and `isManual`
- [ ] All endpoints return correct HTTP status codes
- [ ] Error messages are user-friendly

### Frontend Components

- [ ] Order placement form renders correctly
- [ ] Order type selector shows all 7 types
- [ ] Conditional fields appear based on order type
- [ ] Order preview modal displays all cost details
- [ ] Order history table shows all orders
- [ ] Filters and pagination work correctly
- [ ] Manual refresh button triggers order status update

### Exchange Integration

- [ ] Orders submitted to exchange via CCXT
- [ ] Exchange order IDs captured and stored
- [ ] Order status reflects exchange state
- [ ] Cancellation propagates to exchange
- [ ] Fee information retrieved from exchange
- [ ] Rate limiting respected (no 429 errors)

### Background Jobs

- [ ] Order sync task runs on schedule
- [ ] Sync updates order status from exchange
- [ ] Sync handles manual and automated orders
- [ ] No errors in BullMQ logs

---

## Success Criteria

All scenarios above must pass with ✅ results.

**Acceptance Sign-off**:
- [ ] All 5 primary scenarios validated
- [ ] All 4 edge cases handled correctly
- [ ] Background sync working
- [ ] Performance targets met (50 concurrent orders, <3s response time)
- [ ] Database integrity maintained
- [ ] No console errors or unhandled exceptions
- [ ] Exchange integration verified on testnet

---

**Validated By**: _______________
**Date**: _______________
**Notes**: _______________
