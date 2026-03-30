---
description: Portfolio aggregation across algo trading strategies — positions, P&L, allocation
globs:
  - 'apps/api/src/portfolio/**'
---

# Portfolio Module

## Overview

3 files. Algo trading portfolio aggregation across strategies. Asset allocation, P&L, and performance metrics.

## API Routes

All JWT-guarded at `/portfolio`:

| Route                          | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `GET /summary`                 | Aggregated portfolio across all strategies |
| `GET /performance`             | Overall P&L, returns, win rate             |
| `GET /positions`               | All positions grouped by strategy          |
| `GET /performance/by-strategy` | Per-strategy P&L breakdown                 |
| `GET /allocation`              | Allocation percentages by symbol           |

## PortfolioAggregationService

- `getAggregatedPortfolio(userId)` — single DB call, in-memory grouping by symbol, fetches current prices
- `getPositionsByStrategy(userId)` — groups by `strategyConfigId`, per-strategy P&L
- `getAllocationBreakdown(userId)` — allocation % per symbol

### Price Fetching Fallback Chain

`RealtimeTickerService.price` → `Coin.currentPrice` → `avgEntryPrice`

Graceful degradation — returns empty map on failure, never throws.

## Dependencies

- `PositionTrackingService` — position data
- `UserPerformanceService` — performance metrics
- `CoinService`, `RealtimeTickerService` — pricing
- Circular deps with `CoinModule`, `OHLCModule`, `StrategyModule` via `forwardRef()`

## Patterns

- `Decimal.js` for all P&L calculations — converts to numbers only for final output
- Single DB query per aggregation with in-memory Map grouping
- Weighted average price: `weightedCost / quantity`
- Unrealized P&L: `(marketPrice - avgPrice) × quantity`

## Portfolio Capacity Gate

`PortfolioCapacityGate` in `strategy/gates/` — max 35 active strategies, critical severity (blocks promotions).
