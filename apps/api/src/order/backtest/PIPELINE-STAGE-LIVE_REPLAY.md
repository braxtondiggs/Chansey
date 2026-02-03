# LIVE_REPLAY Stage - Real-Time Simulation Backtest

This document describes the **LIVE_REPLAY** stage of the Strategy Development Pipeline.

## Overview

The LIVE_REPLAY stage replays recent market data with realistic timing and execution conditions. Unlike historical
backtesting, live replay simulates the actual experience of trading in real-time, including execution delays and market
microstructure effects.

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIVE_REPLAY STAGE                             │
│                                                                  │
│  Historical Results                                              │
│         │                                                        │
│         ▼                                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │         Live Replay Backtest (Recent Data)              │     │
│  │  ─────────────────────────────────────────────────────  │     │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │     │
│  │  With realistic timing  │  Execution delays  │  Slippage │     │
│  └────────────────────────────────────────────────────────┘     │
│         │                                                        │
│         ▼                                                        │
│  Compare with Historical → Measure Degradation                   │
└─────────────────────────────────────────────────────────────────┘
```

## Purpose

- **Test Recent Market Conditions**: Validate strategy on most recent data
- **Realistic Execution**: Simulate order execution delays and fills
- **Measure Degradation**: Compare performance vs historical backtest
- **Detect Timing Issues**: Catch look-ahead bias and latency sensitivity
- **Bridge to Live Trading**: Closest simulation to real trading

## How It Works

1. **Receives** optimized parameters and historical baseline
2. **Loads** recent market data (typically last month)
3. **Replays** candles with optional real-time pacing
4. **Simulates** realistic order execution
5. **Measures** degradation from historical performance
6. **Validates** against progression thresholds

## Key Differences from Historical

| Aspect      | HISTORICAL       | LIVE_REPLAY               |
| ----------- | ---------------- | ------------------------- |
| Data Period | 3+ months ago    | Last month                |
| Execution   | Instant fills    | Simulated delays          |
| Timing      | No pacing        | Optional real-time pacing |
| Purpose     | Baseline metrics | Realistic validation      |
| Degradation | N/A              | Measured vs historical    |

## Configuration

```typescript
interface LiveReplayStageConfig {
  /** Start date for replay (ISO string) */
  startDate: string;

  /** End date for replay (ISO string) */
  endDate: string;

  /** Initial capital for replay */
  initialCapital: number; // Default: 10000

  /** Trading fee as decimal */
  tradingFee?: number; // Default: 0.001

  /** Market data set ID */
  marketDataSetId?: string; // Default: 'default-historical-data'

  /** Enable real-time pacing */
  enablePacing?: boolean; // Default: false

  /** Pacing speed multiplier (1 = real-time) */
  pacingSpeed?: number; // Default: 1
}
```

### Date Range Defaults

```
Historical Period: [Start - 4 months] to [Start - 1 month]
Live Replay Period: [Start - 1 month] to [Now]
```

This ensures no data overlap between historical and live replay testing.

## Progression Criteria

To advance to the PAPER_TRADE stage:

| Metric              | Threshold | Description                        |
| ------------------- | --------- | ---------------------------------- |
| **Sharpe Ratio**    | ≥ 0.8     | Slightly relaxed from historical   |
| **Max Drawdown**    | ≤ 30%     | Allows 5% more vs historical       |
| **Max Degradation** | ≤ 20%     | Return degradation from historical |

### Degradation Calculation

```typescript
degradation = ((historicalReturn - liveReplayReturn) / |historicalReturn|) * 100
```

- Positive degradation = performance dropped
- Negative degradation = performance improved (rare)
- > 20% degradation suggests potential overfitting

## Output

### LiveReplayStageResult

```typescript
interface LiveReplayStageResult {
  backtestId: string;
  status: 'COMPLETED' | 'FAILED';

  // Core metrics
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;

  // Capital metrics
  initialCapital: number;
  finalValue: number;
  annualizedReturn: number;

  // Trade breakdown
  winningTrades: number;
  losingTrades: number;

  // Degradation from historical
  degradationFromHistorical?: number;

  // Execution info
  duration: number;
  completedAt: string;
}
```

## Key Services

| Service                | File                         | Responsibility                   |
| ---------------------- | ---------------------------- | -------------------------------- |
| `BacktestService`      | `backtest.service.ts`        | Backtest creation and management |
| `LiveReplayProcessor`  | `live-replay.processor.ts`   | BullMQ processor for replay      |
| `BacktestEngine`       | `backtest-engine.service.ts` | Core simulation engine           |
| `BacktestPauseService` | `backtest-pause.service.ts`  | Pause/resume via Redis           |

## Live Replay Features

### Real-Time Pacing

When `enablePacing: true`:

```
1 candle per actual candle duration (e.g., 1 hour candles = 1 hour between)
```

With `pacingSpeed: 60`:

```
60x faster (1 hour candle = 1 minute between)
```

### Execution Simulation

```typescript
interface ReplayExecutionConfig {
  // Minimum delay before order fills
  minExecutionDelayMs: number; // Default: 100

  // Maximum delay before order fills
  maxExecutionDelayMs: number; // Default: 500

  // Slippage model
  slippageModel: 'fixed' | 'proportional' | 'volume_based';

  // Slippage percentage
  slippageBps: number; // Basis points
}
```

### Checkpoint System

Live replay supports checkpointing for pause/resume:

```typescript
interface BacktestCheckpointState {
  lastProcessedIndex: number;
  currentPositions: Map<string, Position>;
  accountBalances: Map<string, number>;
  runningMetrics: MetricsSnapshot;
  persistedCounts: {
    trades: number;
    signals: number;
    fills: number;
    snapshots: number;
  };
}
```

## Event Flow

```
Pipeline completes HISTORICAL stage
         │
         ▼
PipelineOrchestrator.executeLiveReplayStage()
         │
         ├─► BacktestService.createBacktest(type: LIVE_REPLAY)
         │     └─► Queues job to replayQueue
         │
         ▼
    [Async Processing]
         │
         ├─► LiveReplayProcessor.process()
         │     ├─► Validate dataset is replay-capable
         │     ├─► Initialize from checkpoint if resuming
         │     ├─► For each candle (with pacing):
         │     │     ├─► Check pause flag
         │     │     ├─► Generate signals
         │     │     ├─► Simulate execution delay
         │     │     ├─► Execute orders with slippage
         │     │     ├─► Update positions
         │     │     └─► Save checkpoint periodically
         │     ├─► Calculate final metrics
         │     └─► Compare with historical
         │
         ▼
BacktestResultService emits 'backtest.completed'
         │
         ▼
Pipeline.handleBacktestComplete('LIVE_REPLAY')
         │
         ├─► Check Sharpe ≥ 0.8
         ├─► Check Drawdown ≤ 30%
         ├─► Check Degradation ≤ 20%
         │
         ├─► All pass: Advance to PAPER_TRADE
         └─► Any fail: Pipeline status → FAILED
```

## Pause/Resume Behavior

### Pause

```typescript
await backtestService.pauseBacktest(user, backtestId);
// Sets pause flag in Redis
// Processor saves checkpoint at next opportunity
// Processing stops gracefully
```

### Resume

```typescript
await backtestService.resumeBacktest(user, backtestId);
// Clears pause flag
// Processor detects checkpoint
// Cleans up orphaned data
// Resumes from last checkpoint
```

## Data Requirements

### Replay-Capable Dataset

A dataset must have `replayCapable: true` to be used for live replay:

```typescript
// Validation in LiveReplayProcessor
if (!dataset.replayCapable) {
  throw new Error('Dataset is not flagged as replay capable');
}
```

Replay-capable datasets include:

- Tick-level or 1-minute data
- Bid/ask spreads (optional)
- Volume data
- No significant gaps

## Degradation Analysis

### Expected Degradation

| Degradation | Interpretation                      |
| ----------- | ----------------------------------- |
| 0-10%       | Excellent - strategy is robust      |
| 10-20%      | Acceptable - normal variance        |
| 20-30%      | Concerning - review strategy        |
| >30%        | Likely overfitting or timing issues |

### Common Causes of High Degradation

1. **Look-Ahead Bias**: Using future data in historical backtest
2. **Timing Sensitivity**: Strategy requires precise execution
3. **Market Regime Change**: Recent conditions differ from historical
4. **Overfitting**: Parameters too specific to historical period
5. **Execution Assumptions**: Historical assumed better fills

## API Reference

### Create Live Replay Backtest (Internal)

```typescript
const backtest = await backtestService.createBacktest(user, {
  name: 'Pipeline - Live Replay',
  type: BacktestType.LIVE_REPLAY,
  algorithmId: strategyConfig.algorithmId,
  marketDataSetId: 'default-historical-data',
  startDate: config.startDate,
  endDate: config.endDate,
  initialCapital: 10000,
  tradingFee: 0.001,
  strategyParams: optimizedParameters
});
```

## Best Practices

1. **Recent Data**: Use most recent available data
2. **No Overlap**: Ensure no overlap with historical period
3. **Realistic Settings**: Enable execution delays and slippage
4. **Monitor Degradation**: Flag strategies with >15% degradation
5. **Multiple Runs**: Consider multiple replay runs for confidence

## Common Issues

### "Dataset is not replay capable"

- Dataset lacks tick-level data
- Use a different dataset with replay support
- Upgrade dataset to include required fields

### "High degradation from historical"

- Review optimization for overfitting
- Check if market conditions changed significantly
- Validate execution assumptions

### "Checkpoint recovery failed"

- Clear checkpoint and restart from beginning
- Check Redis connectivity
- Verify data integrity

## Monitoring

### Key Metrics to Track

```typescript
// Degradation from historical
const degradation = ((historicalReturn - replayReturn) / Math.abs(historicalReturn)) * 100;

// Execution quality
const avgSlippage = totalSlippage / totalFills;
const fillRate = executedOrders / attemptedOrders;

// Timing metrics
const avgLatency = totalLatency / totalOrders;
```

## Related Documentation

- [Pipeline README](../../pipeline/README.md)
- [HISTORICAL Stage](./PIPELINE-STAGE-HISTORICAL.md)
- [PAPER_TRADE Stage](../paper-trading/PIPELINE-STAGE-PAPER_TRADE.md)
- [LiveReplayProcessor](./live-replay.processor.ts)
- [ADR-001: Pipeline Architecture](../../pipeline/docs/adr-001-pipeline-architecture.md)
