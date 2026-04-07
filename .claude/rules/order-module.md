---
description: Order execution — live trades, backtests, paper trading, simulated fills
globs:
  - 'apps/api/src/order/**'
---

# Order Module

## Overview

172 files handling all trade execution across 4 modes: Live (`Order`), Backtest (`BacktestTrade`), Paper
(`PaperTradingOrder`). The `BacktestSharedModule` is the cross-cutting layer used by Historical, Live Replay, and Paper
Trading stages.

## Directory Layout

```
order/
├── backtest/
│   ├── shared/           # BacktestSharedModule — 7 shared services
│   ├── dto/              # Backtest DTOs
│   └── *.ts              # Processors + services at root (incl. live-replay.processor.ts)
├── paper-trading/        # Separate from backtest (sibling, not nested)
│   ├── dto/
│   └── entities/
├── config/
├── dto/
├── entities/
├── interfaces/
├── services/
├── tasks/                # BullMQ consumers and scheduled tasks
├── utils/
└── order.module.ts
```

## Key Patterns

- **BacktestSharedModule**: 7 services reused across all simulation modes — slippage, fees, positions, metrics,
  portfolio state, signal throttle, signal filter chain
- **Exit system**: `ExitConfig` interface defines exit rules. Live uses `PositionManagementService`; simulated modes use
  `BacktestExitTracker`
- **Entity hierarchy**: `Backtest` → `BacktestTrade`/`BacktestSnapshot`/`BacktestSignal` → `SimulatedOrderFill`

## BullMQ Queues

7 queues: `order-queue`, `backtest-historical`, `backtest-live-replay`, `paper-trading`, `trade-execution`,
`position-monitor`, `liquidation-monitor`

## How to Add a New Execution Mode

1. Create a new subdirectory under `backtest/` or `order/`
2. Implement a processor extending the shared backtest services
3. Register a new BullMQ queue in the module
4. Add the consumer to module providers
5. Wire up the pipeline stage in the strategy module if needed

## Gotchas

- Circular dependency with `AlgorithmModule` resolved via `forwardRef()` — maintain this pattern
- `BacktestTrade` and `Order` are separate entities with different schemas — don't assume field parity
- Simulated fills go through `SimulatedOrderFill`, not the real `Order` entity
