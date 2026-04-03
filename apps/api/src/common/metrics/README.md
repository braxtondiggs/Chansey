# Metrics

## Overview

Financial metrics calculation utilities for evaluating trading strategy performance. Provides statistical functions for risk-adjusted returns, drawdown analysis, and portfolio correlation. Used by backtest, optimization, and live trading modules.

## Dual API Pattern

The metrics module exposes two complementary APIs: 13 **pure functions** (import directly, no DI required) and 3 **injectable services** (register in your domain module's `providers`). Neither is centrally registered -- import them directly where needed.

## Pure Functions

Exported from `metric-calculator.ts`. No dependencies, no DI -- import and call directly.

| Function | Description |
|---|---|
| `calculateMean` | Arithmetic mean (average) |
| `calculateStandardDeviation` | Population standard deviation |
| `calculateVariance` | Population variance |
| `calculateMedian` | Median value (interpolates for even-length arrays) |
| `calculatePercentile` | Percentile with linear interpolation (0-100) |
| `calculateCumulativeReturn` | Compound cumulative return from period returns |
| `annualizeReturn` | Annualize a total return given period count |
| `annualizeVolatility` | Annualize volatility (stddev * sqrt(periodsPerYear)) |
| `calculateDownsideDeviation` | Semi-deviation below a minimum acceptable return |
| `calculateRollingWindow` | Generic rolling window with custom calculator callback |
| `calculateEMA` | Exponential moving average (first value seeded with SMA) |
| `calculateZScore` | Standardized z-score of a value within a dataset |
| `calculateRankPercentile` | Rank percentile of a value within a dataset |

## Injectable Services

NestJS `@Injectable()` services. Add to `providers` in your domain module.

- **`SharpeRatioCalculator`** -- Sharpe ratio, Sortino ratio, and rolling Sharpe. `calculateFromMetrics()` for pre-computed annualized inputs. `interpretSharpe()` returns a human-readable grade (`excellent`, `good`, `acceptable`, `poor`). Clamps output to `MAX_SHARPE = 100` to prevent overflow.

- **`DrawdownCalculator`** -- Max drawdown, all drawdown periods, average drawdown, duration statistics, Calmar ratio, and underwater plot. `calculateFromReturns()` converts period returns to equity curve internally. `interpretDrawdown()` returns a severity level (`low`, `moderate`, `high`, `extreme`).

- **`CorrelationCalculator`** -- Pearson and Spearman correlation, correlation matrix, rolling correlation, Beta, and Alpha. `findHighlyCorrelatedPairs()` extracts pairs above a threshold from a correlation matrix. `interpretCorrelation()` returns strength and direction.

## Gotchas

- **Not centrally registered** -- import calculators directly in domain modules that need them.
- **`periodsPerYear` defaults to 252** (stock trading days). For 24/7 crypto markets, pass `365` explicitly.
- **`MIN_STDDEV = 1e-10`** in `SharpeRatioCalculator` -- near-zero volatility returns `0` instead of exploding.
- Services include `interpret*()` helpers that return human-readable grades/severity for display or alerting.
