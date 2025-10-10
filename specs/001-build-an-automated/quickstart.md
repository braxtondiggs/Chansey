# Quickstart: Automated Trading Platform Validation

**Purpose**: End-to-end validation of automated cryptocurrency trading functionality
**Duration**: ~15 minutes
**Prerequisites**: Database migrated, API running, test user with Binance US credentials

## Test Environment Setup

### 1. Database Seeding

```bash
# Run migration
npm run migration:run

# Seed test data
npm run seed:automated-trading
```

**Seed Data Requirements**:
- Test user: `test@example.com` / `password123`
- Binance US exchange key (testnet): `key: test_binance_key`, `secret: test_binance_secret`
- Test algorithm: "Simple Moving Average Strategy" (id: uuid)

### 2. Start Services

```bash
# Terminal 1: Start API
npm run api

# Terminal 2: Start Redis (if not running)
redis-server

# Terminal 3: Start Frontend (optional, for UI testing)
npm run site
```

## Test Scenario 1: Algorithm Activation

**Goal**: Activate algorithm and verify it starts monitoring for trade signals

### Step 1: Get Available Algorithms

```bash
curl -X GET http://localhost:3000/api/algorithms \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
[
  {
    "id": "algo-uuid-123",
    "name": "Simple Moving Average Strategy",
    "description": "Technical analysis using SMA crossovers",
    "category": "technical",
    "status": "active",
    "evaluate": true
  }
]
```

### Step 2: Activate Algorithm

```bash
curl -X POST http://localhost:3000/api/algorithms/algo-uuid-123/activate \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "exchangeKeyId": "exchange-key-uuid-456"
  }'
```

**Expected Response** (201 Created):
```json
{
  "id": "activation-uuid-789",
  "userId": "user-uuid-001",
  "algorithmId": "algo-uuid-123",
  "exchangeKeyId": "exchange-key-uuid-456",
  "isActive": true,
  "allocationPercentage": 1.0,
  "activatedAt": "2025-09-30T12:00:00Z",
  "createdAt": "2025-09-30T12:00:00Z"
}
```

### Step 3: Verify Activation

```bash
curl -X GET http://localhost:3000/api/algorithms/active \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
[
  {
    "id": "activation-uuid-789",
    "algorithm": {
      "id": "algo-uuid-123",
      "name": "Simple Moving Average Strategy"
    },
    "isActive": true,
    "allocationPercentage": 1.0
  }
]
```

**✅ Pass Criteria**:
- HTTP 201 on activation
- `isActive` = true
- `activatedAt` timestamp set
- Algorithm appears in `/algorithms/active` list

## Test Scenario 2: Automated Trade Execution

**Goal**: Trigger trade signal and verify order execution via BullMQ

### Step 1: Trigger Mock Trade Signal

```bash
# Manually add job to trade-execution queue (simulates algorithm signal)
curl -X POST http://localhost:3000/api/admin/queues/trade-execution/add \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "execute-trade",
    "payload": {
      "algorithmActivationId": "activation-uuid-789",
      "userId": "user-uuid-001",
      "exchangeKeyId": "exchange-key-uuid-456",
      "signal": {
        "action": "BUY",
        "symbol": "BTC/USDT",
        "quantity": 0.001
      }
    }
  }'
```

### Step 2: Wait for Job Processing

```bash
# Job should process within 5 minutes (per NFR-001)
# Monitor logs for: "TradeExecutionTask: Processing trade signal"
tail -f logs/api.log | grep TradeExecutionTask
```

### Step 3: Verify Order Creation

```bash
curl -X GET http://localhost:3000/api/orders?algorithmActivationId=activation-uuid-789 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
[
  {
    "id": "order-uuid-999",
    "symbol": "BTC/USDT",
    "side": "BUY",
    "quantity": 0.001,
    "status": "FILLED",
    "algorithmActivationId": "activation-uuid-789",
    "transactTime": "2025-09-30T12:05:00Z"
  }
]
```

**✅ Pass Criteria**:
- Order created within 5 minutes
- `algorithmActivationId` matches activation
- Order status = FILLED or PARTIALLY_FILLED (per clarification: accept partial fills)
- Trade recorded in database with correct user/exchange

## Test Scenario 3: Performance Metrics Calculation

**Goal**: Verify performance metrics are calculated and cached

### Step 1: Trigger Performance Ranking Job

```bash
# Manually trigger performance calculation (normally runs every 5 minutes)
curl -X POST http://localhost:3000/api/admin/queues/performance-ranking/trigger \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

### Step 2: Query Performance Metrics

```bash
curl -X GET http://localhost:3000/api/algorithms/algo-uuid-123/performance \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
{
  "id": "performance-uuid-111",
  "algorithmActivationId": "activation-uuid-789",
  "roi": 2.5,
  "winRate": 100.0,
  "sharpeRatio": 1.2,
  "maxDrawdown": 0.0,
  "totalTrades": 1,
  "volatility": 0.15,
  "alpha": 0.02,
  "beta": 0.8,
  "rank": 1,
  "calculatedAt": "2025-09-30T12:10:00Z"
}
```

**✅ Pass Criteria**:
- Metrics calculated for activation
- `totalTrades` = 1 (from previous test)
- `roi`, `winRate`, `sharpeRatio` present (not null)
- `rank` = 1 (only algorithm active for user)

## Test Scenario 4: Dynamic Allocation Adjustment

**Goal**: Verify allocation percentage adjusts based on performance ranking

### Step 1: Activate Second Algorithm (Lower Performance)

```bash
# Activate second algorithm
curl -X POST http://localhost:3000/api/algorithms/algo-uuid-456/activate \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "exchangeKeyId": "exchange-key-uuid-456"
  }'

# Simulate lower performance by creating losing trade
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH/USDT",
    "side": "SELL",
    "quantity": 0.1,
    "price": 1800,
    "status": "FILLED",
    "algorithmActivationId": "activation-uuid-999",
    "gainLoss": -50.0
  }'
```

### Step 2: Trigger Ranking Calculation

```bash
curl -X POST http://localhost:3000/api/admin/queues/performance-ranking/trigger \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

### Step 3: Verify Allocation Adjustment

```bash
curl -X GET http://localhost:3000/api/algorithms/rankings \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
[
  {
    "algorithmActivation": {
      "id": "activation-uuid-789",
      "algorithmId": "algo-uuid-123",
      "allocationPercentage": 1.5  // Increased (better performer)
    },
    "performance": {
      "roi": 2.5,
      "rank": 1
    }
  },
  {
    "algorithmActivation": {
      "id": "activation-uuid-999",
      "algorithmId": "algo-uuid-456",
      "allocationPercentage": 0.5  // Decreased (worse performer)
    },
    "performance": {
      "roi": -2.8,
      "rank": 2
    }
  }
]
```

**✅ Pass Criteria**:
- Higher-ranked algorithm has higher `allocationPercentage`
- Lower-ranked algorithm has lower `allocationPercentage`
- Allocation percentages sum to reasonable total (not exceeding portfolio limits)

## Test Scenario 5: Algorithm Deactivation

**Goal**: Deactivate algorithm and verify trade execution stops

### Step 1: Deactivate Algorithm

```bash
curl -X POST http://localhost:3000/api/algorithms/algo-uuid-123/deactivate \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
{
  "id": "activation-uuid-789",
  "isActive": false,
  "deactivatedAt": "2025-09-30T12:20:00Z"
}
```

### Step 2: Verify No New Trades

```bash
# Trigger trade signal (should be ignored)
curl -X POST http://localhost:3000/api/admin/queues/trade-execution/add \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "execute-trade",
    "payload": {
      "algorithmActivationId": "activation-uuid-789",
      "signal": {
        "action": "BUY",
        "symbol": "BTC/USDT",
        "quantity": 0.001
      }
    }
  }'

# Wait 5 minutes, then check orders
sleep 300
curl -X GET http://localhost:3000/api/orders?algorithmActivationId=activation-uuid-789 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected**: No new orders created (only 1 order from earlier test)

**✅ Pass Criteria**:
- `isActive` = false
- `deactivatedAt` timestamp set
- Trade execution queue skips inactive algorithms
- No new orders created after deactivation

## Test Scenario 6: Historical Performance Data

**Goal**: Verify performance history is queryable for charting

### Step 1: Query Performance History

```bash
curl -X GET "http://localhost:3000/api/algorithms/algo-uuid-123/performance/history?from=2025-09-30T00:00:00Z&to=2025-09-30T23:59:59Z&interval=1h" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**Expected Response** (200 OK):
```json
[
  {
    "calculatedAt": "2025-09-30T12:00:00Z",
    "roi": 0.0,
    "totalTrades": 0
  },
  {
    "calculatedAt": "2025-09-30T13:00:00Z",
    "roi": 2.5,
    "totalTrades": 1
  }
]
```

**✅ Pass Criteria**:
- Array of performance snapshots returned
- Timestamps align with requested interval
- Metrics show progression over time

## Validation Checklist

All test scenarios must pass for feature to be considered complete:

- [x] **Scenario 1**: Algorithm activation succeeds, appears in active list
- [x] **Scenario 2**: Trade signal triggers order execution within 5 minutes
- [x] **Scenario 3**: Performance metrics calculated (ROI, Sharpe, volatility, etc.)
- [x] **Scenario 4**: Allocation percentage adjusts based on ranking
- [x] **Scenario 5**: Deactivation stops trade execution, preserves history
- [x] **Scenario 6**: Historical performance data queryable for charts

## Success Criteria Summary

✅ **Functional Requirements Met**:
- FR-002: Algorithm activation
- FR-003: Algorithm deactivation
- FR-012: Automated trade execution
- FR-015: Partial fill handling (accept and log)
- FR-017: Dynamic allocation based on performance
- FR-022: Comprehensive performance metrics

✅ **Non-Functional Requirements Met**:
- NFR-001: Trade execution within 5 minutes
- API response times <200ms for CRUD operations

✅ **Integration Points Validated**:
- BullMQ queue processing
- CCXT exchange API integration
- TypeORM database operations
- JWT authentication

## Troubleshooting

**Issue**: Trade execution job not processing
- **Check**: Redis connection (`redis-cli ping`)
- **Check**: BullMQ queue status (`GET /api/admin/queues`)
- **Check**: Worker logs (`tail -f logs/worker.log`)

**Issue**: Performance metrics not calculating
- **Check**: Performance ranking job scheduled (`GET /api/admin/queues/performance-ranking/jobs`)
- **Check**: Sufficient trade data (need 10+ trades for meaningful Sharpe ratio)
- **Check**: `technicalindicators` npm package installed

**Issue**: Orders not appearing in database
- **Check**: CCXT exchange connection (`GET /api/exchange-keys/:id/test`)
- **Check**: Exchange API rate limits not exceeded
- **Check**: Order entity relationships (algorithmActivationId foreign key)

## Next Steps

After quickstart validation:
1. Run integration test suite: `npm run test:integration`
2. Run E2E tests: `npm run test:e2e`
3. Performance load testing: `npm run test:load`
4. Deploy to staging environment
5. Monitor BullMQ dashboard for job health
