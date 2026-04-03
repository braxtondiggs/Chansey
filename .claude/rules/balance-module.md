---
description: Balance module — current balances, historical tracking, chart downsampling
globs:
  - "apps/api/src/balance/**"
---

# Balance Module

## Current Balances

- `getCurrentBalances()` — Redis cached 60s (`balance:user:{id}:current`)
- Exchange fetches run in parallel via `Promise.allSettled` with 15s timeout per exchange

## Background Sync

- `BalanceSyncTask` — BullMQ `balance-queue`, runs hourly
- Skipped in dev env or when `DISABLE_BACKGROUND_TASKS=true`
- Users processed in chunks of 5

## Chart Downsampling

| Period | Granularity |
|--------|-------------|
| ≤2 days | Hourly |
| ≤14 days | Daily |
| ≤90 days | Weekly |
| 91+ days | Monthly |

Basic interval sampling (not LTTB).

## Holdings

- `getHoldingsForCoin()` computes from live balance (not order history)
- Average buy price is always `0` (not calculated)

## Historical Data

Uses closest-match algorithm per exchange per period.
