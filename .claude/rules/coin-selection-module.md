---
description: Coin selection — manual/automatic/watched selections, OHLC pre-fetching
globs:
  - "apps/api/src/coin-selection/**"
---

# Coin Selection Module

## Selection Types

`CoinSelectionType` enum: `MANUAL`, `AUTOMATIC`, `WATCHED`

## Dual Query Pattern

- **User-scoped**: `getCoinSelectionsByUser` — for user-facing APIs
- **Global system**: `getCoinSelections`, `getCoinSelectionCoins` — for background algorithm execution

## Sorting

`getCoinSelectionsByUser` orders by:
- `coin.name ASC` when coin relation is loaded
- `createdAt ASC` otherwise

## Background Task

`coin-selection-historical-price.task.ts` — pre-fetches OHLC data for selected coins.

## Dependencies

- Circular dependency with OHLC: `forwardRef(() => OHLCService)`
