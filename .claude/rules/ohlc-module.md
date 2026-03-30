---
description: 1-hour OHLC candle pipeline — fetch, cache, store, serve, backfill
globs:
  - "apps/api/src/ohlc/**"
---

# OHLC Module

## Overview

20 files. 1-hour OHLC candle pipeline: fetch → cache → store → serve.

## Entities

- `OHLCCandle`: unique on `coinId+timestamp+exchangeId`, prices `decimal(25,8)`
- `ExchangeSymbolMap`: coin-to-exchange mapping with priority + health tracking

## Data Flow

CCXT → `ExchangeOHLCService.fetchOHLCWithFallback()` (priority: binance_us → gdax → kraken, 500ms fallback delay) → `OHLCSyncTask` (hourly) → `upsertCandles()` → PostgreSQL.

## Backfill

`OHLCBackfillService`: batches of 500 candles, 100ms delay, Redis progress tracking (`ohlc:backfill:{coinId}`), 1-year default lookback.

## Realtime

`RealtimeTickerService`: 45s Redis cache (`ticker:price:{coinId}`), returns 24h stats.

## Symbol Map Seeding

Top 50 coins on first boot, weekly refresh (Sunday 4AM), prefers `/USD` over `/USDT`.

## Health & Pruning

- Auto-deactivation after 24 consecutive failures
- `OHLCPruneTask`: daily 3AM, 365-day retention

## Key Types

`PriceSummary extends CandleData` — compatibility interface for algorithm strategies.

## BullMQ

Queues: `ohlc-sync-queue`, `ohlc-prune-queue`. Tasks live here (not in `tasks/`).

## Price Ranges

`PriceRange` enum: `30m | 1h | 6h | 12h | 1d | 7d | 14d | 30d | 90d | 180d | 1y | 5y | all`
