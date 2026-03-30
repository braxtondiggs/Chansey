# Risk Checks

## Overview

Runtime risk monitoring checks for deployed (live) strategies. These checks run hourly via a background job orchestrated by `RiskManagementService`, which evaluates all active deployments and logs results to the audit trail. When a check with `autoDemote=true` fails at `severity='critical'`, the deployment is automatically demoted to prevent further losses.

## Checks

| Name | Priority | AutoDemote | Threshold |
|------|----------|------------|-----------|
| `drawdown-breach` | 1 | Yes | Current drawdown exceeds 1.5x backtest max drawdown limit |
| `daily-loss-limit` | 2 | Yes | Daily loss exceeds deployment's configured limit (default 5%) |
| `consecutive-losses` | 3 | Yes | Warns at 10+ losing days, auto-demotes at 15+ consecutive losing days |
| `volatility-spike` | 4 | Yes | Warns at 2x expected volatility, auto-demotes at 3x expected |
| `sharpe-degradation` | 5 | No | Live Sharpe ratio drops 50%+ from backtest Sharpe (warning only) |
| `concentration-risk` | 6 | No | Single asset exceeds concentration limit for user's risk level (warning only) |

## Interface

```typescript
IRiskCheck.evaluate(deployment, latestMetric, historicalMetrics?)
```

Returns a `RiskCheckResult`:

```typescript
{
  checkName: string;
  passed: boolean;
  actualValue: number | string;
  threshold: number | string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendedAction?: string;
  metadata?: Record<string, any>;
}
```

Severity is a four-level enum, not a boolean. The `passed` field indicates whether the check is within acceptable limits, while `severity` conveys how far outside limits a failing check is.

## How to Add a New Check

1. Create a new `@Injectable()` class in `risk/` implementing `IRiskCheck`. Set `name`, `description`, `priority` (lower = runs first), and `autoDemote`.
2. Register the class in the `providers` array of `strategy.module.ts`.
3. Inject it into `RiskManagementService` constructor -- it will be added to the sorted `checks` array automatically.

## Gotchas

- `autoDemote=true` alone does not trigger demotion. The check must also return `severity='critical'` on failure. This allows tiered checks (e.g., `consecutive-losses` warns at `high` severity for 10 days but only demotes at `critical` for 15+).
- These checks run hourly, distinct from the per-trade `PreTradeRiskGateService` which gates individual trades in real time.
- Most checks need `historicalMetrics` for trend analysis. `RiskManagementService` loads the last 30 days of `PerformanceMetric` records for each evaluation.
- `concentration-risk` is unique: it fetches live balances and user risk level rather than relying on `PerformanceMetric` data.
- If a check throws, `RiskManagementService` catches the error and records a failing result with `severity='critical'`.
