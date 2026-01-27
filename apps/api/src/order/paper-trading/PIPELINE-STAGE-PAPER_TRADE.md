# PAPER_TRADE Stage - Live Market Simulation

This document describes the **PAPER_TRADE** stage of the Strategy Development Pipeline.

## Overview

The PAPER_TRADE stage is the final validation before deployment, running the strategy against live market data without risking real capital. This stage tests the strategy under current market conditions in real-time.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAPER_TRADE STAGE                             │
│                                                                  │
│  Live Replay Results                                             │
│         │                                                        │
│         ▼                                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │          Paper Trading Session                          │     │
│  │  ─────────────────────────────────────────────────────  │     │
│  │  📈 Live Market Data                                    │     │
│  │  💰 Simulated Capital ($10,000)                        │     │
│  │  ⏱️  Duration: 7-14 days (risk-dependent)              │     │
│  │  🛑 Auto-stop on drawdown/target                       │     │
│  └────────────────────────────────────────────────────────┘     │
│         │                                                        │
│         ▼                                                        │
│  Final Metrics → Deployment Recommendation                       │
└─────────────────────────────────────────────────────────────────┘
```

## Purpose

- **Live Validation**: Test strategy with actual real-time market data
- **Current Conditions**: Verify performance in current market regime
- **Risk Validation**: Ensure drawdown stays within acceptable limits
- **Final Gate**: Last check before risking real capital
- **Build Confidence**: Extended testing period builds trust

## How It Works

1. **Receives** optimized parameters and live replay baseline
2. **Connects** to live exchange data via exchange key
3. **Runs** strategy against real-time price feeds
4. **Executes** simulated trades (no real orders)
5. **Monitors** for stop conditions (drawdown, target, duration)
6. **Compares** final metrics against thresholds

## Configuration

```typescript
interface PaperTradingStageConfig {
  /** Initial capital for paper trading */
  initialCapital: number;        // Default: 10000

  /** Duration string (e.g., '7d', '14d', '30d') */
  duration: string;              // Risk-dependent

  /** Trading fee as decimal */
  tradingFee?: number;           // Default: 0.001

  /** Auto-stop conditions */
  stopConditions?: {
    /** Stop if drawdown exceeds this percentage */
    maxDrawdown?: number;        // Default: 0.25 (25%)

    /** Stop if return reaches target */
    targetReturn?: number;       // Default: 0.50 (50%)
  };

  /** Tick interval in milliseconds */
  tickIntervalMs?: number;       // Default: 30000 (30s)
}
```

### Risk-Based Duration

| Risk Level | Duration | Description |
|------------|----------|-------------|
| 1 (Conservative) | 14 days | Longest validation |
| 2 | 10 days | |
| 3 (Moderate) | 7 days | Default |
| 4 | 5 days | |
| 5 (Aggressive) | 3 days | Shortest validation |

## Progression Criteria

To complete the pipeline successfully:

| Metric | Threshold | Description |
|--------|-----------|-------------|
| **Sharpe Ratio** | ≥ 0.7 | Further relaxed from live replay |
| **Max Drawdown** | ≤ 35% | Allows 5% more vs live replay |
| **Total Return** | ≥ 0% | Must at least break even |

## Output

### PaperTradingStageResult

```typescript
interface PaperTradingStageResult {
  sessionId: string;
  status: 'COMPLETED' | 'STOPPED' | 'FAILED';

  // Core metrics
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;

  // Capital metrics
  initialCapital: number;
  finalValue: number;
  totalFees: number;

  // Degradation from live replay
  degradationFromLiveReplay?: number;

  // Stop information
  stoppedReason?: string;        // 'duration_reached', 'target_reached', 'drawdown_exceeded', etc.
  durationHours: number;

  completedAt: string;
}
```

## Key Services

| Service | File | Responsibility |
|---------|------|----------------|
| `PaperTradingService` | `paper-trading.service.ts` | Session management |
| `PaperTradingEngineService` | `paper-trading-engine.service.ts` | Core trading engine |
| `PaperTradingMarketDataService` | `paper-trading-market-data.service.ts` | Live price feeds |
| `PaperTradingProcessor` | `paper-trading.processor.ts` | BullMQ job processor |
| `PaperTradingStreamService` | `paper-trading-stream.service.ts` | WebSocket updates |

## Session Lifecycle

```
PAUSED (initial) → RUNNING → STOPPED/COMPLETED
                      │
                      └──► PAUSED (can resume)
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `PAUSED` | Initial state, or user-paused |
| `RUNNING` | Actively processing market data |
| `STOPPED` | Terminated by stop condition or user |
| `COMPLETED` | Duration reached with passing metrics |
| `FAILED` | Error or threshold violation |

## Event Flow

```
Pipeline completes LIVE_REPLAY stage
         │
         ▼
PipelineOrchestrator.executePaperTradingStage()
         │
         ├─► PaperTradingService.startFromPipeline()
         │     ├─► Create session with optimized parameters
         │     ├─► Initialize accounts
         │     └─► Queue start job
         │
         ▼
    [Real-Time Processing]
         │
         ├─► PaperTradingProcessor runs tick loop:
         │     ├─► Fetch current market prices
         │     ├─► Generate strategy signals
         │     ├─► Execute simulated orders
         │     ├─► Update positions and balances
         │     ├─► Calculate running metrics
         │     ├─► Check stop conditions
         │     └─► Save snapshot
         │
         ├─► On duration_reached or target_reached:
         │     └─► Stop session gracefully
         │
         ├─► On drawdown_exceeded:
         │     └─► Stop session (may fail thresholds)
         │
         ▼
PaperTradingService emits 'paper-trading.completed'
         │
         ▼
Pipeline.handlePaperTradingComplete()
         │
         ├─► Check Sharpe ≥ 0.7
         ├─► Check Drawdown ≤ 35%
         ├─► Check Return ≥ 0%
         │
         ├─► All pass: Pipeline COMPLETED → Generate recommendation
         └─► Any fail: Pipeline FAILED
```

## Stop Conditions

### Duration Reached
```typescript
if (elapsedHours >= parseDuration(config.duration)) {
  await this.stopSession(sessionId, 'duration_reached');
}
```

### Target Return Reached
```typescript
if (metrics.totalReturnPercent >= config.stopConditions.targetReturn * 100) {
  await this.stopSession(sessionId, 'target_reached');
}
```

### Max Drawdown Exceeded
```typescript
if (metrics.maxDrawdown > config.stopConditions.maxDrawdown) {
  await this.stopSession(sessionId, 'drawdown_exceeded');
}
```

### User Cancellation
```typescript
await this.stopSession(sessionId, 'user_cancelled');
```

### Pipeline Cancellation
```typescript
await this.stopSession(sessionId, 'pipeline_cancelled');
```

## Pause/Resume Behavior

### Pause
```typescript
await paperTradingService.pause(sessionId, user);
// Removes tick job from queue
// Session status → PAUSED
// Positions and balances preserved
```

### Resume
```typescript
await paperTradingService.resume(sessionId, user);
// Re-queues tick job
// Session status → RUNNING
// Continues from current state
```

## Market Data Integration

### Exchange Connection

Paper trading uses the user's exchange key for market data:

```typescript
// Connects to exchange API for price feeds
const exchangeKey = await this.exchangeKeyRepository.findOne({
  where: { id: config.exchangeKeyId },
  relations: ['exchange']
});

// Uses CCXT for standardized API access
const exchange = ccxt[exchangeKey.exchange.ccxtId];
```

### Tick Processing

```typescript
interface TickProcessing {
  // Fetch current prices for all trading pairs
  const prices = await marketDataService.fetchPrices(symbols);

  // Generate signals from strategy
  const signals = await strategyEngine.evaluate(prices, positions);

  // Execute simulated orders
  const fills = await executeOrders(signals, prices);

  // Update portfolio
  await updatePositions(fills);

  // Calculate metrics
  const metrics = calculateMetrics(portfolio, prices);

  // Save snapshot
  await saveSnapshot(metrics);
}
```

## Deployment Recommendations

After paper trading completes, the pipeline generates a final recommendation:

| Recommendation | Criteria |
|----------------|----------|
| **DEPLOY** | Sharpe ≥ 1.0, Drawdown ≤ 25%, Win Rate ≥ 50%, Consistent across stages |
| **NEEDS_REVIEW** | Sharpe ≥ 0.5, Drawdown ≤ 40%, Win Rate ≥ 40% |
| **DO_NOT_DEPLOY** | Below thresholds or critical warnings |

## API Reference

### Start from Pipeline (Internal)

```typescript
const session = await paperTradingService.startFromPipeline({
  pipelineId: pipeline.id,
  algorithmId: strategyConfig.algorithmId,
  exchangeKeyId: pipeline.exchangeKeyId,
  initialCapital: 10000,
  optimizedParameters: pipeline.optimizedParameters,
  duration: '7d',
  stopConditions: {
    maxDrawdown: 0.25,
    targetReturn: 0.50
  },
  userId: user.id,
  name: 'Pipeline - Paper Trading'
});
```

### Pause Session

```typescript
await paperTradingService.pause(sessionId, user);
```

### Resume Session

```typescript
await paperTradingService.resume(sessionId, user);
```

### Stop Session

```typescript
await paperTradingService.stop(sessionId, user, 'user_cancelled');
```

## Entities

### PaperTradingSession
Main session entity tracking the paper trading run.

### PaperTradingAccount
Virtual accounts holding currency balances.

### PaperTradingOrder
Simulated orders placed by the strategy.

### PaperTradingSignal
Strategy signals that triggered orders.

### PaperTradingSnapshot
Periodic snapshots of portfolio performance.

## Best Practices

1. **Full Duration**: Let sessions run full duration when possible
2. **Don't Cherry-Pick**: Include all market conditions
3. **Monitor Actively**: Watch for unexpected behavior
4. **Multiple Sessions**: Consider running multiple paper sessions
5. **Realistic Timing**: Don't artificially speed up

## Common Issues

### "Exchange key not found"
- Ensure user has configured exchange API keys
- Verify exchange key is active

### "Failed to fetch market data"
- Exchange API may be rate limited
- Check exchange connectivity
- Verify API key permissions

### "Session stopped unexpectedly"
- Check stop condition thresholds
- Review logs for errors
- Verify strategy isn't generating invalid signals

### "Degradation from live replay too high"
- Market conditions may have changed
- Strategy may be sensitive to market regime
- Review recent market events

## WebSocket Events

Paper trading emits real-time updates:

```typescript
// Price updates
{ event: 'price', sessionId, data: { symbol, price, timestamp } }

// Order fills
{ event: 'fill', sessionId, data: { orderId, symbol, side, amount, price } }

// Position updates
{ event: 'position', sessionId, data: { symbol, amount, avgPrice, unrealizedPnL } }

// Metrics snapshots
{ event: 'metrics', sessionId, data: { totalReturn, drawdown, sharpe, winRate } }

// Status changes
{ event: 'status', sessionId, data: { status, reason } }
```

## Monitoring

### Key Metrics to Track

```typescript
// Real-time P&L
const unrealizedPnL = calculateUnrealizedPnL(positions, currentPrices);
const realizedPnL = sumCompletedTrades(trades);
const totalPnL = unrealizedPnL + realizedPnL;

// Drawdown monitoring
const currentDrawdown = (peakValue - currentValue) / peakValue;

// Win rate tracking
const winRate = winningTrades / totalTrades;

// Risk metrics
const sharpe = calculateRollingSharpe(returns, window);
```

## Related Documentation

- [Pipeline README](../../pipeline/README.md)
- [LIVE_REPLAY Stage](../backtest/PIPELINE-STAGE-LIVE_REPLAY.md)
- [PaperTradingEngine Service](./paper-trading-engine.service.ts)
- [ADR-001: Pipeline Architecture](../../pipeline/docs/adr-001-pipeline-architecture.md)
