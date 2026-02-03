# HISTORICAL Stage - Full Historical Backtest

This document describes the **HISTORICAL** stage of the Strategy Development Pipeline.

## Overview

The HISTORICAL stage runs a complete backtest on historical market data using the optimized parameters from the OPTIMIZE stage. This establishes baseline performance expectations.

```
┌─────────────────────────────────────────────────────────────────┐
│                     HISTORICAL STAGE                             │
│                                                                  │
│  Optimized Parameters                                            │
│         │                                                        │
│         ▼                                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │          Full Historical Backtest                       │     │
│  │  ─────────────────────────────────────────────────────  │     │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │     │
│  │  Start Date                                  End Date   │     │
│  └────────────────────────────────────────────────────────┘     │
│         │                                                        │
│         ▼                                                        │
│  Performance Metrics (Sharpe, Return, Drawdown, Win Rate)        │
└─────────────────────────────────────────────────────────────────┘
```

## Purpose

- **Validate Optimized Parameters**: Test parameters on full historical period
- **Establish Baseline Metrics**: Create performance benchmark for later stages
- **Generate Trade History**: Complete record of simulated trades
- **Identify Potential Issues**: Detect drawdowns, poor periods, etc.

## How It Works

1. **Receives** optimized parameters from OPTIMIZE stage
2. **Loads** historical market data for configured date range
3. **Simulates** trading using the strategy algorithm
4. **Records** all trades, signals, and performance snapshots
5. **Calculates** comprehensive performance metrics
6. **Compares** against progression thresholds

## Configuration

```typescript
interface HistoricalStageConfig {
  /** Start date for backtest (ISO string) */
  startDate: string;

  /** End date for backtest (ISO string) */
  endDate: string;

  /** Initial capital for backtest */
  initialCapital: number;        // Default: 10000

  /** Trading fee as decimal (e.g., 0.001 = 0.1%) */
  tradingFee?: number;           // Default: 0.001

  /** Market data set ID */
  marketDataSetId?: string;      // Default: 'default-historical-data'
}
```

### Risk-Based Defaults

| Risk Level | Historical Period | Initial Capital |
|------------|-------------------|-----------------|
| All Levels | 3 months (ending 1 month ago) | $10,000 |

## Progression Criteria

To advance to the LIVE_REPLAY stage:

| Metric | Threshold | Description |
|--------|-----------|-------------|
| **Sharpe Ratio** | ≥ 1.0 | Risk-adjusted return quality |
| **Max Drawdown** | ≤ 25% | Maximum peak-to-trough decline |
| **Win Rate** | ≥ 45% | Percentage of profitable trades |

## Output

### HistoricalStageResult

```typescript
interface HistoricalStageResult {
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

  // Execution info
  duration: number;              // Seconds
  completedAt: string;
}
```

## Key Services

| Service | File | Responsibility |
|---------|------|----------------|
| `BacktestService` | `backtest.service.ts` | Backtest creation and management |
| `BacktestEngine` | `backtest-engine.service.ts` | Core simulation engine |
| `BacktestProcessor` | `backtest.processor.ts` | BullMQ job processor |
| `BacktestResultService` | `backtest-result.service.ts` | Result storage and retrieval |
| `MetricsService` | `../../metrics/metrics.service.ts` | Performance calculation |

## Backtest Types

```typescript
enum BacktestType {
  HISTORICAL = 'HISTORICAL',     // ← Used by this stage
  LIVE_REPLAY = 'LIVE_REPLAY',   // Used by LIVE_REPLAY stage
  OPTIMIZATION = 'OPTIMIZATION'  // Used by OPTIMIZE stage internally
}
```

## Event Flow

```
Pipeline completes OPTIMIZE stage
         │
         ▼
PipelineOrchestrator.executeHistoricalStage()
         │
         ├─► BacktestService.createBacktest(type: HISTORICAL)
         │     └─► Queues job to historicalQueue
         │
         ▼
    [Async Processing]
         │
         ├─► BacktestProcessor.process()
         │     ├─► Load market data
         │     ├─► Initialize portfolio
         │     ├─► For each candle:
         │     │     ├─► Generate signals
         │     │     ├─► Execute orders
         │     │     └─► Update positions
         │     ├─► Calculate final metrics
         │     └─► Save results
         │
         ▼
BacktestResultService emits 'backtest.completed'
         │
         ▼
Pipeline.handleBacktestComplete('HISTORICAL')
         │
         ├─► Check Sharpe ≥ 1.0
         ├─► Check Drawdown ≤ 25%
         ├─► Check Win Rate ≥ 45%
         │
         ├─► All pass: Advance to LIVE_REPLAY
         └─► Any fail: Pipeline status → FAILED
```

## Pause/Resume Behavior

### Pause
```typescript
await backtestPauseService.setPauseFlag(backtestId);
// Sets Redis flag that processor checks periodically
// Backtest saves checkpoint and pauses execution
```

### Resume
```typescript
await backtestService.resumeBacktest(user, backtestId);
// Clears pause flag
// Backtest resumes from last checkpoint
```

### Checkpoint System
- Checkpoints saved every N candles (configurable)
- Contains: processed index, positions, balances, metrics
- Enables resume without data loss

## Market Data Sets

```typescript
interface MarketDataSet {
  id: string;
  name: string;
  symbols: string[];             // e.g., ['BTC/USDT', 'ETH/USDT']
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  startDate: Date;
  endDate: Date;
  integrityScore: number;        // Data quality (0-100)
  replayCapable: boolean;        // Has tick-level data
}
```

## Performance Metrics

### Sharpe Ratio
```
sharpeRatio = (annualizedReturn - riskFreeRate) / annualizedVolatility
```
- Risk-free rate typically 0% for crypto
- Higher is better (>1.0 is good, >2.0 is excellent)

### Maximum Drawdown
```
maxDrawdown = max((peak - trough) / peak) for all peaks
```
- Expressed as percentage (0.25 = 25%)
- Lower is better

### Win Rate
```
winRate = winningTrades / totalTrades
```
- Expressed as decimal (0.45 = 45%)
- Context-dependent (some strategies are profitable with <50% win rate)

### Total Return
```
totalReturn = (finalValue - initialCapital) / initialCapital
```
- Expressed as decimal (0.15 = 15%)

## API Reference

### Create Backtest (Internal)

```typescript
const backtest = await backtestService.createBacktest(user, {
  name: 'Pipeline - Historical',
  type: BacktestType.HISTORICAL,
  algorithmId: strategyConfig.algorithmId,
  marketDataSetId: 'default-historical-data',
  startDate: config.startDate,
  endDate: config.endDate,
  initialCapital: 10000,
  tradingFee: 0.001,
  strategyParams: optimizedParameters
});
```

### Pause Backtest

```typescript
await backtestService.pauseBacktest(user, backtestId);
```

### Resume Backtest

```typescript
await backtestService.resumeBacktest(user, backtestId);
```

### Cancel Backtest

```typescript
await backtestService.cancelBacktest(user, backtestId);
```

## Best Practices

1. **Sufficient Data**: Use at least 3 months of historical data
2. **Include Bad Periods**: Don't cherry-pick favorable market conditions
3. **Realistic Fees**: Use actual exchange fee rates
4. **Slippage Consideration**: Account for execution slippage in volatile markets
5. **Out-of-Sample**: Historical period should differ from optimization period

## Common Issues

### "Market dataset not found"
- Ensure `marketDataSetId` exists in database
- Check data has been ingested for required symbols

### "Dataset validation failed"
- Data may not cover requested date range
- Data integrity score may be too low
- Missing symbols in dataset

### "Sharpe ratio below threshold"
- Strategy may not be profitable
- Check if optimized parameters make sense
- Review trade signals for issues

### "Excessive drawdown"
- Strategy may be too aggressive
- Consider position sizing adjustments
- Review risk management parameters

## Database Schema

### Backtest Entity
```sql
CREATE TABLE backtest (
  id UUID PRIMARY KEY,
  name VARCHAR,
  type VARCHAR,              -- HISTORICAL, LIVE_REPLAY, OPTIMIZATION
  status VARCHAR,            -- PENDING, RUNNING, PAUSED, COMPLETED, FAILED
  algorithm_id UUID,
  market_data_set_id UUID,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  initial_capital DECIMAL,
  final_value DECIMAL,
  total_return DECIMAL,
  sharpe_ratio DECIMAL,
  max_drawdown DECIMAL,
  win_rate DECIMAL,
  total_trades INTEGER,
  ...
);
```

## Related Documentation

- [Pipeline README](../../pipeline/README.md)
- [LIVE_REPLAY Stage](./PIPELINE-STAGE-LIVE_REPLAY.md)
- [BacktestEngine Service](./backtest-engine.service.ts)
- [ADR-001: Pipeline Architecture](../../pipeline/docs/adr-001-pipeline-architecture.md)
