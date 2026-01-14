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
const gaps = await ohlcService.detectGaps(coinId, new Date('2024-01-01'), new Date('2024-12-31'));
// Returns array of { start: Date, end: Date } for missing periods
```

## CSV Import Format for Backtesting

The `MarketDataReaderService` can read historical market data from CSV files stored in MinIO/S3 for backtesting. This
allows importing data from external sources or using custom datasets.

### Required Columns

| Column    | Aliases                    | Description                                    |
| --------- | -------------------------- | ---------------------------------------------- |
| timestamp | `time`, `date`, `datetime` | Candle timestamp (see supported formats below) |
| close     | `c`, `price`               | Closing price                                  |

### Optional Columns

| Column | Aliases                   | Default                             | Description    |
| ------ | ------------------------- | ----------------------------------- | -------------- |
| open   | `o`                       | Same as close                       | Opening price  |
| high   | `h`                       | Same as close                       | Highest price  |
| low    | `l`                       | Same as close                       | Lowest price   |
| volume | `vol`, `v`                | 0                                   | Trading volume |
| symbol | `coin`, `asset`, `ticker` | First in dataset instrumentUniverse | Asset symbol   |

### Supported Timestamp Formats

- **ISO 8601**: `2024-01-01T00:00:00Z` or `2024-01-01T00:00:00.000Z`
- **Unix seconds**: `1704067200` (integers between years 2000-2100)
- **Unix milliseconds**: `1704067200000` (integers > year 2000 in ms)

### Example CSV Files

**Minimal (close prices only):**

```csv
timestamp,close
2024-01-01T00:00:00Z,42000.50
2024-01-01T01:00:00Z,42100.00
2024-01-01T02:00:00Z,41950.25
```

**Full OHLCV with symbol:**

```csv
timestamp,open,high,low,close,volume,symbol
2024-01-01T00:00:00Z,42000.50,42150.00,41900.00,42100.00,1500.5,BTC
2024-01-01T01:00:00Z,42100.00,42200.00,42000.00,42150.00,1200.0,BTC
2024-01-01T00:00:00Z,2200.00,2220.00,2180.00,2210.00,8500.0,ETH
2024-01-01T01:00:00Z,2210.00,2230.00,2200.00,2225.00,7200.0,ETH
```

**Unix timestamps:**

```csv
time,price,vol
1704067200,42000.50,1500
1704070800,42100.00,1200
1704074400,41950.25,1800
```

### Storage Location Formats

CSV files can be referenced using any of these formats in `MarketDataSet.storageLocation`:

| Format      | Example                                         |
| ----------- | ----------------------------------------------- |
| Direct path | `datasets/btc-hourly-2024.csv`                  |
| S3 URL      | `s3://bucket-name/datasets/btc-hourly-2024.csv` |
| HTTP URL    | `http://minio:9000/bucket/datasets/file.csv`    |

### File Size Limits

- Maximum file size: **100 MB**
- For larger datasets, split into multiple files by date range

### Error Handling

- Rows with invalid timestamps or prices are skipped
- Warning logged if >10% of rows have parse errors
- Error thrown if no valid rows are found

## Dependencies

- **CoinModule**: For coin lookups and price updates
- **ExchangeModule**: For exchange configurations and CCXT clients
- **SharedCacheModule**: For Redis caching
- **BullMQ**: For background job processing
