# Paper Trading

## Overview

Tick-based paper trading execution engine that simulates live trading against real-time exchange prices without risking actual funds. BullMQ repeatable jobs fire every N seconds (default 30s), fetching current prices via CCXT, running the configured algorithm, and executing simulated orders against virtual account balances. Each tick is stateless and independent -- all persistent state lives in the database, making the system resilient to restarts.

## Files

| File | Purpose |
|------|---------|
| `paper-trading.module.ts` | NestJS module registration (queue, entities, providers) |
| `paper-trading.config.ts` | `registerAs('paperTrading')` config: tick interval, retry limits, allocation bounds, cache TTLs, WebSocket CORS |
| `paper-trading.controller.ts` | REST API: CRUD sessions, start/pause/resume/stop, query orders/signals/snapshots/positions/performance |
| `paper-trading.service.ts` | Session lifecycle management, BullMQ job scheduling (`upsertJobScheduler` for ticks, one-shot for retries) |
| `paper-trading-engine.service.ts` | Core tick logic: fetch prices, build `AlgorithmContext`, run algorithm, execute orders, record snapshots. Reuses `BacktestSharedModule` services (fees, metrics, portfolio state, signal throttle, signal filter chain) |
| `paper-trading-market-data.service.ts` | Live price fetching via CCXT with short-TTL cache, order book retrieval for realistic slippage, OHLCV candle history for indicator computation |
| `paper-trading-stream.service.ts` | Redis Streams telemetry publisher (status, tick, metric, log, order, balance scopes) |
| `paper-trading-recovery.service.ts` | Boot-time recovery of active sessions + 5-min cron watchdog (10 min stale = recover, 20 min stale = mark FAILED) |
| `paper-trading.gateway.ts` | WebSocket gateway (`socket.io`) for real-time session telemetry to frontend clients |
| `paper-trading.job-data.ts` | Job type enum and typed payload interfaces for all BullMQ job variants |
| `entities/` | TypeORM entities: `PaperTradingSession`, `PaperTradingAccount`, `PaperTradingOrder`, `PaperTradingSignal`, `PaperTradingSnapshot` |
| `dto/` | Request/response DTOs: `CreatePaperTradingSessionDto`, filter DTOs, response DTOs |

## Architecture

- **Tick-based, not loop-based.** `PaperTradingService.scheduleTickJob()` creates a BullMQ repeatable job via `upsertJobScheduler()` that fires every `tickIntervalMs` (default 30s). Each tick is processed independently by `PaperTradingProcessor`.
- **Session lifecycle:** `PAUSED -> ACTIVE -> PAUSED/STOPPED/COMPLETED/FAILED`. Sessions are created in `PAUSED` status and must be explicitly started. Five job types flow through a single `paper-trading` queue: `START_SESSION`, `TICK`, `RETRY_TICK`, `STOP_SESSION`, `NOTIFY_PIPELINE`.
- **Account model:** `PaperTradingAccount` tracks `available`, `locked`, and computed `total` balances per currency, with `averageCost` and `entryDate` for hold-period enforcement. This is more realistic than the backtest engine's in-memory `Map<string, number>`.
- **Pipeline integration:** Sessions can be created and auto-started by the pipeline orchestrator via `startFromPipeline()`. On completion, a `NOTIFY_PIPELINE` job emits an event back to the orchestrator. The `pipelineId` and `riskLevel` fields link sessions to their parent pipeline.

## Error Classification

The processor classifies errors into two categories:

- **RecoverableError** (network timeouts, rate limits, 502/503): Increments `consecutiveErrors`. When the threshold is hit (default 3), tick jobs are removed and a one-shot `RETRY_TICK` is scheduled with exponential backoff (base 60s, capped at 30 min). On successful retry, normal ticks resume.
- **UnrecoverableError** (auth failures, invalid config, 401/403): Immediately marks the session as `FAILED` and cleans up all jobs and in-memory state.

After exhausting `maxRetryAttempts` (default 5), the session is permanently paused with `retriesExhausted: true`.

## Entity Relationships

```
PaperTradingSession
  |-- ManyToOne -> User (CASCADE delete)
  |-- ManyToOne -> Algorithm (CASCADE delete)
  |-- ManyToOne -> ExchangeKey (CASCADE delete)
  |-- OneToMany -> PaperTradingAccount (per currency)
  |-- OneToMany -> PaperTradingOrder
  |-- OneToMany -> PaperTradingSignal
  |-- OneToMany -> PaperTradingSnapshot (portfolio value over time)
```

## Gotchas

- **Uses live exchange prices via CCXT, not historical data.** The `PaperTradingMarketDataService` fetches real-time tickers and order books from the configured exchange, with a stale-cache fallback (5 min TTL) when all retries are exhausted.
- **Reuses BacktestSharedModule services.** The engine imports `FeeCalculatorService`, `MetricsCalculatorService`, `PortfolioStateService`, `SignalFilterChainService`, `SignalThrottleService`, and others from `../backtest/shared`.
- **Throttle state is persisted on the session entity** (`throttleState` JSONB column) and restored into in-memory `SignalThrottleService` at the start of each tick, surviving process restarts.
- **Recovery service runs on boot and every 5 minutes.** It also cleans up orphaned legacy repeatable jobs created by the old `queue.add({ repeat })` API that cannot be removed by `removeJobScheduler()`.
- **Stop conditions are checked after every successful tick:** `maxDrawdown` and `targetReturn` thresholds, plus a duration limit parsed from strings like `7d`, `30d`, `3M`.
