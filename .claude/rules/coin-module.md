---
description: Cryptocurrency data — CoinGecko integration, ticker pairs, risk-based selection
globs:
  - "apps/api/src/coin/**"
---

# Coin Module

## Overview

21 files. Cryptocurrency data from CoinGecko + exchange ticker pairs.

## Entities

- `Coin`: market data (prices, ATH/ATL, scores, links JSONB, supply). Relations: Order, CoinSelection, TickerPairs
- `TickerPairs`: unique `(symbol, exchange)`, auto-generated symbol via hooks. Status: `TRADING/BREAK/DELISTED`

## CoinGecko Caching

- `fetchCoinDetail()`: 5min TTL + circuit breaker (3 failures, 60s reset)
- `fetchMarketChart()`: dual cache (primary + stale 24h fallback) + `Promise.race` 30s timeout

## Risk-Based Selection

| Level | Strategy |
|-------|----------|
| 1 | Highest volume |
| 5 | Lowest gecko rank |
| 2-4 | Logarithmic composite |

## Virtual USD

`createVirtualUsdCoin()` returns synthetic Coin with id `USD-virtual`.

## Sync Tasks

- `coin-sync`: weekly (CoinGecko list + ticker pairs)
- `coin-detail`: daily 11PM (batches of 3, 2.5s delay)

## Filtering

`getCoinsByIdsFiltered()`: `minMarketCap` 100M + `minDailyVolume` 1M for backtest quality.

## Helpers

`stripNullProps()`, `sanitizeNumericValue()`. Disabled in dev/`DISABLE_BACKGROUND_TASKS`.
