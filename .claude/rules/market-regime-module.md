---
description: Market regime detection — volatility analysis, BTC trend, regime gating
globs:
  - "apps/api/src/market-regime/**"
---

# Market Regime Module

## Overview

Detects market regime from volatility + BTC trend. Produces `CompositeRegimeType`: `BULL`, `BEAR`, `NEUTRAL`, `EXTREME`.

## Regime Persistence

- Current regime = DB row where `effectiveUntil IS NULL`
- On change: old row gets `effectiveUntil = now()`, new row inserted
- Self-referential `previousRegimeId` for history tracking

## Key Services

### `VolatilityCalculator`
Three methods: standard, exponential (EWMA λ=0.94), Parkinson.

### `CompositeRegimeService`
- Combines volatility regime + BTC 200-day SMA trend filter
- Restores override state from Redis on boot (24h TTL safety expiry)
- **Falls back to `NEUTRAL`** if BTC data unavailable

### `RegimeGateService`
Signal filter for backtest paths:

| Regime | BUY | SELL/SL/TP |
|--------|-----|------------|
| BULL / NEUTRAL | Pass | Pass |
| BEAR / EXTREME | **Blocked** | Pass |

## Shared Types

`VolatilityConfig` and `DEFAULT_VOLATILITY_CONFIG` come from `@chansey/api-interfaces`.

## Gotchas

- Override state is Redis-backed with 24h TTL — if Redis flushes, override resets
- BTC data failure silently degrades to NEUTRAL (no error thrown)
