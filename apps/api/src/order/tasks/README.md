# Tasks

## Overview

BullMQ background job consumers for order-related processing. Each task extends `WorkerHost`, implements `OnModuleInit` for idempotent job scheduling, and reports failures to `FailedJobService`. All tasks skip scheduling in development or when their respective disable flag is set.

## Tasks

| Task | Queue Name | Schedule | Concurrency | Purpose |
|------|-----------|----------|-------------|---------|
| `OrderSyncTask` | `order-queue` | Hourly (prod) / 12h (non-prod) | Sequential per-user | Syncs orders from connected exchanges for all users with active keys. Also schedules a daily midnight cleanup job for stale orders. |
| `TradeExecutionTask` | `trade-execution` | Every 5 minutes | 5 concurrent user groups | Generates algorithm signals and executes trades. Excludes robo-advisor users (handled by LiveTradingService). |
| `PositionMonitorTask` | `position-monitor` | Every 60 seconds | Mutex (concurrency=1, 2min lock) | Monitors active positions with trailing stops, ratchets stop prices as market moves in favor. |
| `LiquidationMonitorTask` | `liquidation-monitor` | Every 60 seconds | Mutex (concurrency=1, 2min lock) | Checks leveraged positions for liquidation risk, classifies as CRITICAL/WARNING/SAFE. |

## BullMQ Pattern

All tasks follow the same structure: `@Processor(queueName)` + `WorkerHost` + `OnModuleInit`. On startup, `onModuleInit()` checks for existing repeatable jobs before adding a new one (idempotent scheduling). Each task uses `@OnWorkerEvent('failed')` to record failures via `FailedJobService.recordFailure()` in a fail-safe wrapper.

## Trade Execution Details

Two-phase processing:

1. **Pre-flight caching** -- For each unique user, fetches portfolio value, balance allocations, risk level, and daily loss limit status. Errors here fail closed (portfolio=0, user blocked).
2. **Per-activation processing** -- Groups activations by user, processes groups in parallel (up to 5 concurrent groups) with sequential processing within each group.

Gates applied to each entry signal: daily loss limit, concentration gate, and trade cooldown (prevents double-trading with Pipeline 1). Per-activation throttle state (cooldowns, daily cap, min sell percentage) is persisted in-memory across cron cycles and pruned when activations are deactivated. Robo-advisor users (`algoTradingEnabled=true`) are filtered out entirely.

## Position Monitor Details

Trailing stop ratchet: the stop price only moves in the favorable direction (up for longs, down for shorts). Supports three trailing types: percentage, fixed amount, and ATR-based (falls back to 2% if ATR unavailable). Three activation modes: immediate, price threshold, and percentage gain.

Stop order replacement uses a cancel-and-replace pattern. The DB update (mark old order canceled, save new order, update position reference) is atomic via `DataSource.transaction()`. If the replacement order fails after cancellation, the position is marked ERROR (unprotected).

Ticker fetching uses batch `fetchTickers` first, falling back to sequential `fetchTicker` per symbol if the batch call is unavailable or fails.

## Gotchas

- **Fail-closed philosophy**: If balance/portfolio fetch errors during trade execution pre-flight, portfolio is set to 0 and the user is blocked from trading that cycle.
- **`@OnWorkerEvent('failed')`**: All tasks record failures to `FailedJobService.recordFailure()`, which is itself fail-safe (never throws).
- **Dev env skips scheduling**: Each task checks `NODE_ENV === 'development'` and its own disable flag.
- **Disable flags**: `DISABLE_BACKGROUND_TASKS=true` (order sync, liquidation monitor), `DISABLE_TRADE_EXECUTION=true` (trade execution), `DISABLE_POSITION_MONITOR=true` (position monitor).
- **Trading kill switch**: `TradeExecutionTask` checks `TradingStateService.isTradingEnabled()` synchronously before any processing -- globally halted trading skips the entire job.
