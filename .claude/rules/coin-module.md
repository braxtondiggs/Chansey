---
description: Cryptocurrency data — CoinGecko integration, ticker pairs, risk-based selection
globs:
  - 'apps/api/src/coin/**'
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

Scores on daily-fresh signals (market cap, volume, 7d/30d momentum) with a small sentiment nudge. Hard filter:
non-delisted, non-stablecoin, `marketCap ≥ 100M`, `totalVolume ≥ 1M`, `currentPrice` not null, and an active
`exchange_symbol_map` row (restricted to the user's connected exchanges when called via
`updateCoinSelectionByUserRisk`).

| Level | Primary weights (size / liq / mo7 / mo30) | Extra filter                   |
| ----- | ----------------------------------------- | ------------------------------ |
| 1     | 0.55 / 0.45 / — / —                       | —                              |
| 2     | 0.45 / 0.40 / — / 0.15                    | —                              |
| 3     | 0.35 / 0.35 / 0.15 / 0.15                 | —                              |
| 4     | 0.25 / 0.35 / 0.25 / 0.15                 | —                              |
| 5     | 0.20 / 0.35 / 0.30 / 0.15                 | `marketCap BETWEEN 50M AND 5B` |

`size = LN(marketCap + 1)`, `liq = LN(totalVolume + 1)`. `sentimentBonus = (COALESCE(sentimentUp, 50) - 50) / 50` scaled
by `SENTIMENT_WEIGHT = 0.10`. Tiebreaker: `marketRank ASC NULLS LAST`.

`geckoRank` stores CoinGecko trending scores (set by `applyTrendingRanks` during daily sync, cleared monthly by the
metadata sync). It is **not** used in the risk-level scoring SQL — only exposed via `CoinResponseDto` for API consumers.

### Fallback chain (when strict query returns < `2 × take` coins)

1. Strict: `marketCap ≥ 100M` (default)
2. Relaxed: `marketCap IS NOT NULL` (drop the 100M floor)

Diversity pruning runs on the first tier that yields ≥ `2 × take` coins. If no tier does, the widest non-empty result is
returned (pruned if it still has ≥ `take`, otherwise returned as-is).

## Virtual USD

`createVirtualUsdCoin()` returns synthetic Coin with id `USD-virtual`.

## Sync Tasks

- `coin-sync`: weekly (CoinGecko list + ticker pairs)
- `coin-detail`: daily 11PM (batches of 3, 2.5s delay)

## Filtering

`getCoinsByIdsFiltered()`: `minMarketCap` 100M + `minDailyVolume` 1M for backtest quality.

## Helpers

`stripNullProps()`, `sanitizeNumericValue()`. Disabled in dev/`DISABLE_BACKGROUND_TASKS`.
