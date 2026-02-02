# OPTIMIZE Stage - Walk-Forward Parameter Optimization

This document describes the **OPTIMIZE** stage of the Strategy Development Pipeline.

## Overview

The OPTIMIZE stage finds optimal strategy parameters using walk-forward analysis, which helps prevent overfitting by
validating parameters on out-of-sample data.

```
┌─────────────────────────────────────────────────────────────────┐
│                      OPTIMIZE STAGE                              │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│  │ Window 1 │   │ Window 2 │   │ Window 3 │   │ Window N │     │
│  │ Train→Test│   │ Train→Test│   │ Train→Test│   │ Train→Test│  │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘     │
│       │              │              │              │             │
│       ▼              ▼              ▼              ▼             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │           Aggregate Test Results → Best Parameters      │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Purpose

- **Find Optimal Parameters**: Systematically search parameter space
- **Prevent Overfitting**: Walk-forward analysis validates on unseen data
- **Establish Baseline**: Compare optimized vs default parameters
- **Measure Improvement**: Quantify gain from optimization

## How It Works

### Walk-Forward Analysis

Instead of optimizing on all historical data (which causes overfitting), walk-forward:

1. **Divides** data into rolling train/test windows
2. **Optimizes** on training data
3. **Validates** on test data (out-of-sample)
4. **Rolls forward** and repeats

### Parameter Search Methods

| Method          | Description                           | Use Case                                    |
| --------------- | ------------------------------------- | ------------------------------------------- |
| `grid_search`   | Exhaustive search of all combinations | Small parameter spaces (<1000 combinations) |
| `random_search` | Random sampling from parameter space  | Large parameter spaces                      |

## Configuration

```typescript
interface OptimizationStageConfig {
  /** Walk-forward training period in days */
  trainDays: number; // Default: 90

  /** Walk-forward testing period in days */
  testDays: number; // Default: 30

  /** Step size for rolling windows */
  stepDays: number; // Default: 14

  /** Optimization objective metric */
  objectiveMetric: 'sharpe_ratio' | 'total_return' | 'sortino_ratio' | 'composite';

  /** Maximum parameter combinations to test */
  maxCombinations?: number; // Default: 500

  /** Enable early stopping */
  earlyStop?: boolean; // Default: true

  /** Patience for early stopping (iterations without improvement) */
  patience?: number; // Default: 20
}
```

### Risk-Based Defaults

| Risk Level       | Train Days | Test Days | Step Days | Max Combinations |
| ---------------- | ---------- | --------- | --------- | ---------------- |
| 1 (Conservative) | 180        | 60        | 30        | 1000             |
| 2                | 120        | 45        | 21        | 750              |
| 3 (Moderate)     | 90         | 30        | 14        | 500              |
| 4                | 60         | 21        | 10        | 300              |
| 5 (Aggressive)   | 30         | 14        | 7         | 200              |

## Progression Criteria

To advance to the HISTORICAL stage:

| Metric                        | Threshold |
| ----------------------------- | --------- |
| **Improvement over baseline** | ≥ 5%      |

The improvement is calculated as:

```
improvement = ((optimizedScore - baselineScore) / baselineScore) * 100
```

## Output

### OptimizationStageResult

```typescript
interface OptimizationStageResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED';
  bestParameters: Record<string, unknown>;
  bestScore: number;
  baselineScore: number;
  improvement: number; // Percentage improvement
  combinationsTested: number;
  totalCombinations: number;
  duration: number; // Seconds
  completedAt: string;
}
```

## Key Services

| Service                           | File                                                 | Responsibility                   |
| --------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `OptimizationOrchestratorService` | `services/optimization-orchestrator.service.ts`      | Main orchestration logic         |
| `GridSearchService`               | `services/grid-search.service.ts`                    | Parameter combination generation |
| `WalkForwardService`              | `../../scoring/walk-forward/walk-forward.service.ts` | Window management                |
| `WindowProcessor`                 | `../../scoring/walk-forward/window-processor.ts`     | Window execution                 |

## Event Flow

```
Pipeline starts OPTIMIZE stage
         │
         ▼
OptimizationOrchestratorService.startOptimization()
         │
         ├─► Generate parameter combinations
         ├─► Create walk-forward windows
         ├─► Queue optimization job
         │
         ▼
    [Async Processing]
         │
         ├─► For each combination:
         │     ├─► Run backtest on each train window
         │     ├─► Evaluate on test window
         │     └─► Calculate aggregate score
         │
         ├─► Apply early stopping if enabled
         ├─► Select best parameters
         │
         ▼
EventEmitter.emit('optimization.completed')
         │
         ▼
Pipeline.handleOptimizationComplete()
         │
         ├─► Check improvement ≥ 5%
         │
         ├─► Pass: Store parameters, advance to HISTORICAL
         └─► Fail: Pipeline status → FAILED
```

## Pause/Resume Behavior

### Pause

- Optimization runs **cannot be paused mid-execution**
- If pipeline is paused during OPTIMIZE, the current optimization completes
- Pipeline advancement is blocked until resumed

### Resume

- If optimization hasn't started: Re-queue the stage
- If optimization is running: Wait for completion
- Completed optimizations trigger normal progression check

## Objective Metrics

### Sharpe Ratio (Default)

Risk-adjusted return: `(return - riskFreeRate) / standardDeviation`

### Total Return

Simple cumulative return over the period

### Sortino Ratio

Like Sharpe, but only penalizes downside volatility

### Composite

Weighted combination of normalized metrics. Each metric is normalized to [0, 1] scale using expected ranges:

```typescript
// Default weights (must sum to 1.0)
weights = {
  sharpeRatio: 0.30,   // Primary: risk-adjusted return
  totalReturn: 0.25,   // Absolute performance
  calmarRatio: 0.15,   // Return / Max Drawdown
  profitFactor: 0.15,  // Gross profit / Gross loss
  maxDrawdown: 0.10,   // Risk measure (inverted)
  winRate: 0.05        // Trade success rate
}

// Normalization ranges
sharpeRatio:  [-1, 3]     // -1 = losing, 3+ = excellent
totalReturn:  [-0.5, 0.5] // -50% to +50%
calmarRatio:  [0, 3]      // Return / max drawdown
profitFactor: [0.5, 3]    // Gross profit / gross loss
maxDrawdown:  [-1, 0]     // -100% to 0% (inverted)
winRate:      [0, 1]      // 0% to 100%

compositeScore = Σ(normalize(metric) × weight)
```

## Early Stopping

When enabled, optimization stops if:

- `patience` iterations pass without improvement
- Improvement threshold (`minImprovement`) not met

This saves computation time when optimal region is found early.

## API Reference

### Start Optimization

```typescript
// Called internally by pipeline orchestrator
const run = await optimizationService.startOptimization(strategyConfigId, parameterSpace, {
  method: 'grid_search',
  maxCombinations: 500,
  objective: { metric: 'sharpe_ratio', minimize: false },
  walkForward: {
    trainDays: 90,
    testDays: 30,
    stepDays: 14,
    method: 'rolling',
    minWindowsRequired: 3
  },
  earlyStop: { enabled: true, patience: 20, minImprovement: 5 }
});
```

### Cancel Optimization

```typescript
await optimizationService.cancelOptimization(runId);
```

### Get Optimization Status

```typescript
const run = await optimizationService.getOptimizationRun(runId);
// Returns: OptimizationRun with status, progress, results
```

## Best Practices

1. **Sufficient Windows**: Ensure at least 3 walk-forward windows for statistical significance
2. **Appropriate Timeframes**: Training period should be 2-3x testing period
3. **Reasonable Combinations**: Start with fewer combinations, increase if needed
4. **Early Stopping**: Enable for large parameter spaces
5. **Baseline Comparison**: Always compare against default parameters

## Common Issues

### "Walk-forward window count too low"

- Increase historical data range
- Reduce `trainDays` or `testDays`
- Reduce `stepDays` for more overlap

### "No improvement over baseline"

- Strategy may already be well-tuned
- Parameter ranges may be too narrow
- Objective metric may not align with strategy goals

### "Optimization timeout"

- Reduce `maxCombinations`
- Enable early stopping
- Use `random_search` instead of `grid_search`

## Related Documentation

- [Pipeline README](../../pipeline/README.md)
- [Walk-Forward Service](../../scoring/walk-forward/README.md)
- [ADR-001: Pipeline Architecture](../../pipeline/docs/adr-001-pipeline-architecture.md)
