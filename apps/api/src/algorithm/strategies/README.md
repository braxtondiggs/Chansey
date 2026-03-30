# Strategies

## Overview

Trading strategy implementations that extend `BaseAlgorithmStrategy` and are registered at module init via the `AlgorithmRegistry`. Each strategy evaluates price data through one or more technical indicators and returns buy/sell signals with confidence scores. All strategies implement the `IIndicatorProvider` interface and use the centralized `IndicatorService` for cached indicator calculations.

## Strategies

| ID | File | Signal Logic |
|----|------|-------------|
| `atr-trailing-stop-001` | `atr-trailing-stop.strategy.ts` | Dynamic stop-loss using ATR-based trailing stop; generates STOP_LOSS/TAKE_PROFIT when price breaches stop level |
| `bb-squeeze-001` | `bollinger-band-squeeze.strategy.ts` | Detects low-volatility squeeze (bandwidth below threshold) then trades the breakout direction |
| `bb-breakout-001` | `bollinger-bands-breakout.strategy.ts` | Momentum breakout: buy when price closes above upper band, sell when below lower band |
| `confluence-001` | `confluence.strategy.ts` | Multi-indicator vote (EMA crossover, RSI, MACD, ATR, Bollinger %B); signal when >= minConfluence agree |
| `ema-rsi-filter-001` | `ema-rsi-filter.strategy.ts` | EMA crossover filtered by RSI to avoid buying overbought / selling oversold |
| `ema-crossover-001` | `exponential-moving-average.strategy.ts` | EMA crossover with price momentum confirmation |
| `macd-crossover-001` | `macd.strategy.ts` | Buy on bullish MACD/signal crossover, sell on bearish crossover |
| `mean-reversion-001` | `mean-reversion.strategy.ts` | Z-score deviation from SMA; buy when oversold below lower band, sell when overbought above upper band |
| `rsi-divergence-001` | `rsi-divergence.strategy.ts` | Bullish divergence (price lower low + RSI higher low) and bearish divergence (price higher high + RSI lower high) |
| `rsi-macd-combo-001` | `rsi-macd-combo.strategy.ts` | Dual confirmation: RSI oversold/overbought AND MACD crossover within a configurable window |
| `rsi-momentum-001` | `rsi.strategy.ts` | Classic RSI: buy when RSI < 30 (oversold), sell when RSI > 70 (overbought) |
| `sma-crossover-001` | `simple-moving-average-crossover.strategy.ts` | SMA fast/slow crossover signals |
| `triple-ema-001` | `triple-ema.strategy.ts` | Three EMAs (fast/medium/slow); signal on alignment change (all bullish or all bearish) |

## Contract

`BaseAlgorithmStrategy` (in `algorithm/base/`) defines the interface every strategy must satisfy.

**Required overrides:**
- `execute(context: AlgorithmContext): Promise<AlgorithmResult>` -- core signal generation logic
- `getConfigSchema(): Record<string, unknown>` -- parameter definitions with types, defaults, and ranges
- `getMinDataPoints(config): number` -- minimum price history length needed for signal generation
- `getIndicatorRequirements(config): IndicatorRequirement[]` -- declares indicators for precomputation during optimization
- `getParameterConstraints(): ParameterConstraint[]` -- cross-parameter constraints (e.g., `fastPeriod < slowPeriod`)

**Protected helpers:**
- `getPrecomputedSlice(context, coinId, key, windowLength)` -- retrieves precomputed indicator data for the backtest fast-path, bypassing per-timestamp Redis lookups
- `createSuccessResult(signals, chartData?, metadata?, exitConfig?)` -- builds a well-formed success result
- `createErrorResult(error, executionTime?)` -- builds a well-formed error result
- `safeExecute(context)` -- wraps `execute()` with error handling, timing metrics, and confidence aggregation

## How to Add a New Strategy

1. Create a new file in `strategies/` with a class extending `BaseAlgorithmStrategy` and implementing `IIndicatorProvider`. Set a unique `readonly id` in kebab-case with numeric suffix (e.g., `'my-strategy-001'`).
2. Add the class to the `providers` array in `algorithm.module.ts`.
3. Add the class to the `ALGORITHM_STRATEGIES_INIT` factory provider so it registers in `AlgorithmRegistry` at startup.
4. Insert a row in the `algorithm` database table with a matching `strategyId` value.

## Gotchas

- Strategy IDs are kebab-case with a numeric suffix (e.g., `rsi-momentum-001`). The ID must exactly match the `strategyId` column in the `algorithm` DB table.
- Suppress chart data when `context.metadata?.backtestId` or `context.metadata?.optimizationId` exists. Every strategy already does this to avoid massive allocations during simulation.
- The registry is populated at module init. A strategy that is not added to the `ALGORITHM_STRATEGIES_INIT` factory will silently fail to register and never receive execution requests.
- All strategies use `IndicatorService` for cached indicator calculations. Do not call indicator calculators directly.
- The `scripts/` directory in the parent `algorithm/` folder is legacy seeding code and is not used at runtime.
