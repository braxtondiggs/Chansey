# Backtest

## Overview

This subfolder implements the backtest execution engine for historical and live-replay simulation modes. It contains 26 root-level source files (plus a `dto/` directory and `shared/` submodule) and lives under the order module. The engine iterates OHLCV candles from a market data set, generates trading signals via pluggable algorithms, executes simulated trades with slippage and fee modeling, and persists results with checkpoint-based resumability.

## Files

| File | Purpose |
|------|---------|
| `backtest-engine.service.ts` | Core simulation loop: iterates candles, runs algorithm, filters signals, executes trades, manages checkpoints |
| `backtest.processor.ts` | BullMQ processor for `backtest-historical` queue; loads dataset and delegates to engine |
| `live-replay.processor.ts` | BullMQ processor for `backtest-live-replay` queue; adds pacing delays to simulate real-time execution |
| `backtest.service.ts` | CRUD operations for backtest entities; queue job creation |
| `backtest.controller.ts` | REST API endpoints (create, list, detail, compare, signals, fills) |
| `backtest.entity.ts` | TypeORM entities: `Backtest`, `BacktestTrade`, `BacktestSignal`, `BacktestPerformanceSnapshot`, `SimulatedOrderFill` |
| `backtest-result.service.ts` | Persists trades, signals, fills, snapshots; computes `BacktestFinalMetrics` |
| `backtest-stream.service.ts` | Redis Streams-based telemetry: logs, metrics, traces, and status updates during execution |
| `backtest.gateway.ts` | WebSocket gateway (`/backtests` namespace) for real-time progress subscriptions |
| `backtest-checkpoint.interface.ts` | `BacktestCheckpointState` interface with SHA256 checksum, portfolio state, RNG state, persisted counts |
| `backtest-recovery.service.ts` | On-boot recovery: re-queues interrupted backtests with valid checkpoints, fails expired ones |
| `backtest-pause.service.ts` | Redis-backed pause/resume flags with TTL; checked by processors between candles |
| `backtest.config.ts` | `registerAs('backtest')` config: queue names, concurrency, telemetry stream settings |
| `backtest.job-data.ts` | `BacktestJobData` type definition for BullMQ job payloads |
| `backtest-pacing.interface.ts` | Live-replay pacing: `ReplaySpeed`, delay calculation, checkpoint intervals |
| `backtest-aborted.error.ts` | Custom error thrown on abort/pause to cleanly exit the engine loop |
| `market-data-set.entity.ts` | TypeORM entity for stored OHLCV datasets (file path, checksum, date range) |
| `market-data-reader.service.ts` | Reads and parses OHLCV data from dataset files |
| `dataset-validator.service.ts` | Validates dataset integrity (checksum, date overlap, storage accessibility) |
| `coin-resolver.service.ts` | Resolves coin entities from dataset symbols |
| `quote-currency-resolver.service.ts` | Determines quote currency for a trading pair |
| `algorithm-watchdog.ts` | Detects stalled algorithms by tracking wall-clock time since last successful execution |
| `comparison-report.entity.ts` | TypeORM entity for side-by-side backtest comparison reports |
| `seeded-random.ts` | Deterministic PRNG with save/restore state for checkpoint-safe reproducibility |
| `incremental-sma.ts` | O(1) incremental Simple Moving Average backed by a circular `Float64Array` |
| `ring-buffer.ts` | Fixed-capacity circular buffer; O(1) push replacing O(K) splice in price windows |
| `dto/backtest.dto.ts` | Request/response DTOs with class-validator decorators |

## Architecture

**BacktestEngine** is the core loop shared by both processors. The two BullMQ processors (`BacktestProcessor` for historical, `LiveReplayProcessor` for live-replay) load the dataset, configure the engine, and delegate execution. `BacktestResultService` handles all database persistence (trades, signals, fills, snapshots, final metrics). `BacktestStreamService` publishes real-time telemetry via Redis Streams, consumed by `BacktestGateway` over WebSockets.

**Checkpoint system**: `BacktestCheckpointState` captures the full execution state (candle index, portfolio positions, cash balance, peak value, max drawdown, RNG state, throttle state, exit tracker state, and persisted result counts). Each checkpoint includes a SHA256 checksum (first 16 chars) computed over the state for integrity verification on resume. `SeededRandom` provides deterministic RNG that can be saved and restored. `IncrementalSma` and `RingBuffer` replace O(N) recomputation with O(1) streaming operations, and their state is inherently checkpoint-safe.

**Data flow**: Create backtest via API --> Queue BullMQ job --> Processor loads dataset and validates --> Engine iterates candles --> Algorithm generates signals --> Signals filtered (regime gate, concentration, throttle) --> Trades executed with slippage/fees --> Checkpoints persisted at intervals (default every 500 candles) --> Final metrics computed and saved.

## Shared Services

The `shared/` directory provides `BacktestSharedModule` -- seven services reused across historical, live-replay, and paper-trading stages:

- **SlippageService**: Configurable slippage simulation
- **FeeCalculatorService**: Flat and maker/taker fee models
- **PositionManagerService**: Position lifecycle (open, close, partial)
- **MetricsCalculatorService**: Performance metrics with timeframe awareness
- **PortfolioStateService**: Portfolio state management and checkpointing
- **SignalThrottleService**: Cooldown periods, daily caps, minimum sell percentage
- **SignalFilterChainService**: Composable filter chain (regime gate, concentration limits)

Paper-trading (`../paper-trading/`) imports `BacktestSharedModule` directly, making `shared/` a cross-module dependency.

## Gotchas

- **Checkpoint checksum verified on resume**: If the checksum does not match, the checkpoint is rejected and the backtest restarts from the beginning.
- **`shared/` is cross-module**: Paper-trading imports `BacktestSharedModule`, so changes there affect three pipeline stages (historical, live-replay, paper-trading).
- **Recovery on boot**: `BacktestRecoveryService` runs at application startup (`OnApplicationBootstrap`) to re-queue interrupted runs. Checkpoints older than 7 days are expired.
- **Pause uses Redis TTL**: Pause flags expire after 1 hour by default to prevent permanently stuck backtests.
- **Optimization is separate**: The optimization processor lives in `src/optimization/`, not here.
- **Existing pipeline docs**: `PIPELINE-STAGE-HISTORICAL.md` and `PIPELINE-STAGE-LIVE_REPLAY.md` in this directory cover pipeline integration details.
