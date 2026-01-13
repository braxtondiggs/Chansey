# OHLC Module

The OHLC (Open-High-Low-Close) module provides cryptocurrency price candle data fetched directly from exchanges,
enabling accurate backtesting and live trading strategies.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              OHLCModule                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────┐ │
│  │   OHLCService    │    │ ExchangeOHLCService│   │ RealtimeTicker   │ │
│  │  (Data Storage)  │◄───│  (Exchange Fetch) │   │   Service        │ │
│  └────────┬─────────┘    └───────────────────┘   └──────────────────┘ │
│           │                       ▲                                     │
│           ▼                       │                                     │
│  ┌──────────────────┐    ┌───────┴───────────┐                         │
│  │  OHLCBackfill    │    │  Exchange Utils   │                         │
│  │    Service       │────│ (Symbol Formatter)│                         │
│  └──────────────────┘    └───────────────────┘                         │
│                                                                          │
│  Background Tasks:                                                       │
│  ┌──────────────────┐    ┌──────────────────┐                          │
│  │   OHLCSyncTask   │    │  OHLCPruneTask   │                          │
│  │ (Hourly Updates) │    │ (Daily Cleanup)  │                          │
│  └──────────────────┘    └──────────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Services

### OHLCService

Core data access layer for OHLC candles and symbol mappings.

**Key Methods:**

| Method                           | Description                             |
| -------------------------------- | --------------------------------------- |
| `saveCandles()`                  | Bulk insert candles                     |
| `upsertCandles()`                | Insert or update on conflict            |
| `getCandlesByDateRange()`        | Query candles within date range         |
| `getCandlesByDateRangeGrouped()` | Query grouped by coinId for backtests   |
| `detectGaps()`                   | Find missing hourly candles             |
| `getActiveSymbolMaps()`          | Get coin-to-exchange mappings           |
| `findAllByDay()`                 | Daily aggregated price data             |
| `findAllByHour()`                | Hourly price data                       |
| `pruneOldCandles()`              | Delete data older than retention period |

### ExchangeOHLCService

Handles fetching OHLC data from cryptocurrency exchanges via CCXT.

**Key Features:**

- Automatic fallback to next exchange on failure
- Exponential backoff retry logic
- Rate limit detection and handling
- Symbol format conversion for exchange-specific naming

**Key Methods:**

| Method                    | Description                               |
| ------------------------- | ----------------------------------------- |
| `fetchOHLCWithFallback()` | Fetch with automatic exchange fallback    |
| `fetchOHLCWithRetry()`    | Fetch from specific exchange with retries |
| `fetchOHLC()`             | Single fetch attempt                      |
| `supportsOHLC()`          | Check if exchange supports OHLCV          |
| `getAvailableSymbols()`   | List USD pairs for an asset               |

### RealtimeTickerService

Provides real-time price data with caching for live trading.

**Key Features:**

- 45-second Redis cache for prices
- Exchange fallback priority
- Batch price fetching for multiple coins

**Key Methods:**

| Method                   | Description               |
| ------------------------ | ------------------------- |
| `getPrice()`             | Get cached or fresh price |
| `getPrices()`            | Batch price lookup        |
| `refreshPrice()`         | Force cache bypass        |
| `syncCoinCurrentPrice()` | Update Coin.currentPrice  |

### OHLCBackfillService

Manages historical data backfilling with progress tracking.

**Key Features:**

- Redis-based progress persistence
- Resumable backfills
- Cancellation support
- Batch processing with rate limiting

**Key Methods:**

| Method               | Description                        |
| -------------------- | ---------------------------------- |
| `startBackfill()`    | Begin backfill for a coin          |
| `resumeBackfill()`   | Continue interrupted backfill      |
| `cancelBackfill()`   | Stop a running backfill            |
| `getProgress()`      | Get current backfill status        |
| `backfillHotCoins()` | Backfill top N coins by market cap |

## Entities

### OHLCCandle

Stores hourly OHLC candle data.

| Column       | Type     | Description                |
| ------------ | -------- | -------------------------- |
| `id`         | UUID     | Primary key                |
| `coinId`     | UUID     | Reference to Coin entity   |
| `exchangeId` | UUID     | Source exchange            |
| `timestamp`  | DateTime | Candle start time (hourly) |
| `open`       | Decimal  | Opening price              |
| `high`       | Decimal  | Highest price              |
| `low`        | Decimal  | Lowest price               |
| `close`      | Decimal  | Closing price              |
| `volume`     | Decimal  | Trading volume             |

**Indexes:**

- `(coinId, timestamp, exchangeId)` - Unique constraint
- `(coinId, timestamp)` - Query optimization
- `(timestamp)` - Pruning queries

### ExchangeSymbolMap

Maps coins to their trading symbols on each exchange.

| Column         | Type     | Description                             |
| -------------- | -------- | --------------------------------------- |
| `id`           | UUID     | Primary key                             |
| `coinId`       | UUID     | Reference to Coin                       |
| `exchangeId`   | UUID     | Reference to Exchange                   |
| `symbol`       | String   | Trading symbol (e.g., "BTC/USD")        |
| `isActive`     | Boolean  | Whether mapping is active               |
| `priority`     | Integer  | Exchange preference (lower = preferred) |
| `lastSyncAt`   | DateTime | Last successful sync                    |
| `failureCount` | Integer  | Consecutive failures                    |

## Background Tasks

### OHLCSyncTask

Runs hourly to fetch latest candles and update `Coin.currentPrice`.

**Job Name:** `ohlc-sync` **Queue:** `ohlc-queue`

**Process:**

1. Get all active symbol mappings
2. Group by coinId (avoid duplicate fetches)
3. Try each exchange in priority order
4. Save candles and update coin prices
5. Track success/failure counts

### OHLCPruneTask

Runs daily at 3:00 AM to delete old candles.

**Job Name:** `ohlc-prune` **Queue:** `ohlc-queue`

**Process:**

1. Calculate cutoff date based on retention
2. Delete all candles older than cutoff
3. Log deletion summary

## Configuration

| Environment Variable       | Default                  | Description                            |
| -------------------------- | ------------------------ | -------------------------------------- |
| `OHLC_SYNC_ENABLED`        | `true`                   | Enable/disable background sync         |
| `OHLC_SYNC_CRON`           | `EVERY_HOUR`             | Cron pattern for sync task             |
| `OHLC_RETENTION_DAYS`      | `365`                    | Days to retain candle data             |
| `OHLC_EXCHANGE_PRIORITY`   | `binance_us,gdax,kraken` | Comma-separated exchange priority      |
| `OHLC_HOT_COINS_LIMIT`     | `150`                    | Number of coins for hot coins backfill |
| `DISABLE_BACKGROUND_TASKS` | `false`                  | Disable all background tasks           |

## API Endpoints

### Health & Status

| Endpoint           | Method | Description          |
| ------------------ | ------ | -------------------- |
| `GET /ohlc/health` | GET    | System health check  |
| `GET /ohlc/status` | GET    | Detailed sync status |

### Candle Data

| Endpoint                    | Method | Description                |
| --------------------------- | ------ | -------------------------- |
| `GET /ohlc/candles/:coinId` | GET    | Get candles for date range |

**Query Parameters:**

- `start` (required): ISO 8601 start date
- `end` (required): ISO 8601 end date

### Backfill Management

| Endpoint                             | Method | Description                   |
| ------------------------------------ | ------ | ----------------------------- |
| `GET /ohlc/backfill`                 | GET    | List all active backfill jobs |
| `GET /ohlc/backfill/:coinId`         | GET    | Get backfill progress         |
| `POST /ohlc/backfill/:coinId`        | POST   | Start backfill for coin       |
| `POST /ohlc/backfill/:coinId/resume` | POST   | Resume interrupted backfill   |
| `POST /ohlc/backfill/:coinId/cancel` | POST   | Cancel running backfill       |
| `POST /ohlc/backfill/hot-coins`      | POST   | Backfill top coins            |

**Query Parameters (hot-coins):**

- `limit` (optional): Number of coins (1-500, default: 150)

## Exchange Symbol Formatting

Different exchanges use different symbol conventions. The module handles this automatically:

| Exchange        | Standard Symbol | Exchange Symbol |
| --------------- | --------------- | --------------- |
| Binance US      | `BTC/USD`       | `BTC/USD`       |
| Coinbase (gdax) | `BTC/USD`       | `BTC/USD`       |
| Kraken          | `BTC/USD`       | `XBT/ZUSD`      |

The `formatSymbolForExchange()` utility in `exchange/utils/` handles these conversions.

## Usage Examples

### Fetch Candles for Backtest

```typescript
const candles = await ohlcService.getCandlesByDateRangeGrouped(
  ['bitcoin-uuid', 'ethereum-uuid'],
  new Date('2024-01-01'),
  new Date('2024-12-31')
);
// Returns: { [coinId]: OHLCCandle[] }
```

### Get Real-time Prices

```typescript
const prices = await realtimeTickerService.getPrices(['bitcoin-uuid', 'ethereum-uuid']);
// Returns: Map<coinId, TickerPrice>
```

### Start Historical Backfill

```typescript
const jobId = await backfillService.startBackfill(coinId);
// Progress tracked in Redis, can be resumed if interrupted
```

### Check Gap Coverage

```typescript
const gaps = await ohlcService.detectGaps(
  coinId,
  new Date('2024-01-01'),
  new Date('2024-12-31')
);
// Returns array of { start: Date, end: Date } for missing periods
```

## Dependencies

- **CoinModule**: For coin lookups and price updates
- **ExchangeModule**: For exchange configurations and CCXT clients
- **SharedCacheModule**: For Redis caching
- **BullMQ**: For background job processing
