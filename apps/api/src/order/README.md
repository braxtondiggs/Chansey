# Order Synchronization Feature

This feature keeps orders in the database synchronized with connected exchanges. It ensures that all transactions made
on exchanges are properly reflected in the database.

## Features

- **Automatic Hourly Sync**: Automatically syncs orders for all users with active exchange keys every hour
- **Manual Sync**: Allows users to manually trigger synchronization via API endpoints
- **Admin Sync**: Provides an endpoint for admins to sync orders for all users

## API Endpoints

- `POST /api/order/sync` - Manually sync orders for the current user
- `POST /api/order/sync/all` - Admin endpoint to sync orders for all users (requires admin role)

## Implementation Details

The synchronization works by:

1. Checking for active exchange keys for users
2. Using the CCXT library to fetch historical orders from exchanges
3. Processing each supported exchange in parallel for better performance
4. Comparing exchange orders with the database to identify new or updated orders
5. Storing new orders in the database and updating existing ones with proper exchange identification

### Architecture

The order synchronization uses a modular approach:

- `syncOrdersForUser()`: Main entry point that orchestrates sync for all exchanges
- `syncOrdersForExchange()`: Handles sync for a specific exchange
- `saveExchangeOrders()`: Saves orders with proper exchange identification
- `fetchHistoricalOrders()`: Retrieves orders from exchange APIs

This design eliminates code duplication and makes it easy to add new exchanges.

## Configuration

The sync frequency can be modified by changing the cron expressions in `order.task.ts`:

```typescript
@Cron(CronExpression.EVERY_HOUR) // Change to desired frequency
async syncAllUsersOrders() {
  // ...
}
```

## Supported Exchanges

Currently supports:

- **Binance US**: Full order synchronization with fee tracking and market order handling
- **Coinbase**: Complete order sync with commission tracking and price calculation

Additional exchanges can be added by:

1. Adding the exchange service to the `exchangeConfigs` array in `syncOrdersForUser`
2. Implementing the exchange client method
3. Adding exchange identification logic in `saveExchangeOrders`

---

# Automated Exit Rules (Stop-Loss / Take-Profit)

This feature provides automated position exit management including stop-loss, take-profit, trailing stops, and OCO
(one-cancels-other) order linking.

## Overview

Exit rules can be attached to entry orders to automatically manage position exits. The system supports:

- **Stop-Loss Orders**: Limit downside risk with fixed, percentage, or ATR-based stops
- **Take-Profit Orders**: Lock in gains at target prices
- **Trailing Stops**: Dynamic stops that follow favorable price movement
- **OCO Linking**: Automatic cancellation of the other leg when SL or TP fills

## Exit Configuration

Exit rules are configured via the `ExitConfig` interface:

```typescript
interface ExitConfig {
  // Stop-Loss Configuration
  enableStopLoss: boolean;
  stopLossType: 'fixed' | 'percentage' | 'atr';
  stopLossValue: number;

  // Take-Profit Configuration
  enableTakeProfit: boolean;
  takeProfitType: 'fixed' | 'percentage' | 'risk_reward';
  takeProfitValue: number;

  // ATR Settings (for ATR-based stops)
  atrPeriod?: number; // Default: 14
  atrMultiplier?: number; // Default: 2.0

  // Trailing Stop Configuration
  enableTrailingStop: boolean;
  trailingType: 'amount' | 'percentage' | 'atr';
  trailingValue: number;
  trailingActivation: 'immediate' | 'price' | 'percentage';
  trailingActivationValue?: number;

  // OCO Configuration
  useOco: boolean;
}
```

### Stop-Loss Types

| Type         | Description             | Example            |
| ------------ | ----------------------- | ------------------ |
| `fixed`      | Absolute price level    | Stop at $45,000    |
| `percentage` | Percentage from entry   | 2% below entry     |
| `atr`        | ATR multiplier distance | 2x ATR below entry |

### Take-Profit Types

| Type          | Description             | Example         |
| ------------- | ----------------------- | --------------- |
| `fixed`       | Absolute price level    | Exit at $55,000 |
| `percentage`  | Percentage from entry   | 5% above entry  |
| `risk_reward` | Multiple of SL distance | 2:1 R:R ratio   |

### Trailing Stop Activation

| Activation   | Description                             |
| ------------ | --------------------------------------- |
| `immediate`  | Trailing starts immediately after entry |
| `price`      | Activates when price reaches target     |
| `percentage` | Activates after X% gain from entry      |

## Architecture

### Key Files

| File                                      | Purpose                                  |
| ----------------------------------------- | ---------------------------------------- |
| `interfaces/exit-config.interface.ts`     | Exit configuration types and enums       |
| `entities/position-exit.entity.ts`        | Tracks exit orders and trailing state    |
| `services/position-management.service.ts` | Core exit order placement and management |
| `tasks/position-monitor.task.ts`          | BullMQ task for trailing stop monitoring |

### Position Exit Entity

Tracks the lifecycle of exit orders:

```typescript
enum PositionExitStatus {
  ACTIVE = 'active', // Exit orders live on exchange
  STOP_LOSS_TRIGGERED = 'sl_triggered', // Stop-loss filled
  TAKE_PROFIT_TRIGGERED = 'tp_triggered', // Take-profit filled
  TRAILING_TRIGGERED = 'trailing_triggered', // Trailing stop filled
  CANCELLED = 'cancelled', // Exit orders manually cancelled
  EXPIRED = 'expired' // Exit orders expired (position closed manually)
}
```

### Exit Price Calculation

The `PositionManagementService.calculateExitPrices()` method computes exit prices:

```typescript
// For LONG positions (side = 'BUY'):
// - Stop-Loss: entry - distance
// - Take-Profit: entry + distance

// For SHORT positions (side = 'SELL'):
// - Stop-Loss: entry + distance
// - Take-Profit: entry - distance

// Risk:Reward take-profit uses SL distance:
takeProfitPrice = entryPrice + slDistance * riskRewardMultiplier;
```

## Position Monitoring Task

The `PositionMonitorTask` runs every 60 seconds to manage trailing stops:

### What It Does

1. Fetches all active positions with trailing stops enabled
2. Groups positions by exchange for batched price fetches
3. Updates trailing stop prices as price moves favorably (ratchet mechanism)
4. Triggers stop orders when price reverses past the trailing stop

### Trailing Stop Logic

```typescript
// For LONG positions:
if (currentPrice > highWaterMark) {
  highWaterMark = currentPrice;
  newStopPrice = currentPrice - trailingDistance;
  // Only raise stop (never lower)
  if (newStopPrice > currentStopPrice) {
    updateStopOrder(newStopPrice);
  }
}

// Trigger if price falls below trailing stop
if (currentPrice <= currentStopPrice) {
  triggerExit();
}
```

### Configuration

Disable in development by setting environment variable:

```bash
DISABLE_POSITION_MONITOR=true
```

Or automatically disabled when `NODE_ENV=development`.

## OCO Order Handling

One-Cancels-Other (OCO) orders ensure only one exit triggers:

### Exchange Support

| Exchange   | OCO Support                       |
| ---------- | --------------------------------- |
| Binance US | Native OCO orders                 |
| Coinbase   | Simulated via position monitoring |

### How It Works

1. When SL or TP fills, the order sync task detects the fill
2. `handleOcoFill()` cancels the linked order
3. Position status updated to reflect which exit triggered

## Usage Examples

### Attaching Exit Rules to an Entry Order

```typescript
const exitConfig: ExitConfig = {
  enableStopLoss: true,
  stopLossType: StopLossType.PERCENTAGE,
  stopLossValue: 2.0, // 2% stop-loss

  enableTakeProfit: true,
  takeProfitType: TakeProfitType.RISK_REWARD,
  takeProfitValue: 2.0, // 2:1 risk-reward

  enableTrailingStop: false,
  useOco: true
};

await positionManagementService.attachExitOrders(entryOrder, exitConfig);
```

### Trailing Stop with Percentage Activation

```typescript
const exitConfig: ExitConfig = {
  enableStopLoss: false,
  enableTakeProfit: false,

  enableTrailingStop: true,
  trailingType: TrailingType.PERCENTAGE,
  trailingValue: 1.5, // Trail 1.5% behind high
  trailingActivation: TrailingActivationType.PERCENTAGE,
  trailingActivationValue: 3.0, // Activate after 3% gain

  useOco: false
};
```

### ATR-Based Dynamic Stop

```typescript
const exitConfig: ExitConfig = {
  enableStopLoss: true,
  stopLossType: StopLossType.ATR,
  stopLossValue: 2.0, // 2x ATR
  atrPeriod: 14,
  atrMultiplier: 2.0,

  enableTakeProfit: true,
  takeProfitType: TakeProfitType.RISK_REWARD,
  takeProfitValue: 3.0, // 3:1 R:R

  enableTrailingStop: false,
  useOco: true
};

// ATR value fetched automatically from price history
await positionManagementService.attachExitOrders(entryOrder, exitConfig, priceData);
```

## Database Schema

The `position_exits` table stores exit order state:

| Column                     | Type          | Description                             |
| -------------------------- | ------------- | --------------------------------------- |
| `id`                       | uuid          | Primary key                             |
| `positionId`               | uuid          | FK to UserStrategyPosition (nullable)   |
| `entry_order_id`           | uuid          | FK to orders table                      |
| `stop_loss_order_id`       | uuid          | FK to stop-loss order (nullable)        |
| `take_profit_order_id`     | uuid          | FK to take-profit order (nullable)      |
| `trailing_stop_order_id`   | uuid          | FK to trailing stop order (nullable)    |
| `user_id`                  | uuid          | FK to users table                       |
| `strategy_config_id`       | uuid          | FK to strategy_configs (nullable)       |
| `exchangeKeyId`            | uuid          | Exchange key used (nullable)            |
| `status`                   | enum          | Current exit status                     |
| `symbol`                   | varchar(20)   | Trading pair (e.g., BTC/USDT)           |
| `quantity`                 | decimal(20,8) | Position quantity                       |
| `side`                     | varchar(4)    | Position side (BUY/SELL)                |
| `exitConfig`               | jsonb         | Full exit configuration                 |
| `entryPrice`               | decimal(20,8) | Entry price for calculations            |
| `stopLossPrice`            | decimal(20,8) | Calculated stop-loss price (nullable)   |
| `takeProfitPrice`          | decimal(20,8) | Calculated take-profit price (nullable) |
| `currentTrailingStopPrice` | decimal(20,8) | Current trailing stop level (nullable)  |
| `trailingHighWaterMark`    | decimal(20,8) | Highest price for longs (nullable)      |
| `trailingLowWaterMark`     | decimal(20,8) | Lowest price for shorts (nullable)      |
| `trailingActivated`        | boolean       | Whether trailing is active              |
| `ocoLinked`                | boolean       | Whether SL/TP are OCO linked            |
| `entryAtr`                 | decimal(20,8) | ATR at time of entry (nullable)         |
| `triggeredAt`              | timestamptz   | When exit was triggered (nullable)      |
| `exitPrice`                | decimal(20,8) | Exit price when triggered (nullable)    |
| `realizedPnL`              | decimal(20,8) | P&L from exit (nullable)                |
| `warnings`                 | jsonb         | Placement warnings (nullable)           |
| `createdAt`                | timestamptz   | Created timestamp                       |
| `updatedAt`                | timestamptz   | Updated timestamp                       |

## Error Handling

Exit order failures are logged but don't fail the entry order:

- Exchange API errors are caught and logged
- Position status set to `ERROR` with error details
- Manual intervention may be required for failed exits

## Testing

Unit tests cover:

- Exit price calculations for all types
- Trailing stop activation logic
- OCO order linking
- Position status transitions

Run tests:

```bash
nx test api --testPathPattern=position-management
nx test api --testPathPattern=position-monitor
```
