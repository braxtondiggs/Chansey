# Gates

## Overview

Promotion gates are quality checks evaluated before a strategy can advance through the pipeline toward live trading.
Each gate inspects a specific criterion (score, drawdown, trade count, etc.) and returns a pass/fail result.
`PromotionGateService` orchestrates all gates in priority order -- if any critical gate fails, promotion is blocked
entirely. Non-critical failures produce warnings but still allow promotion.

## Gates

| Name                 | Priority | Critical | Threshold         | Description                             |
| -------------------- | -------- | -------- | ----------------- | --------------------------------------- |
| `minimum-score`      | 1        | Yes      | >= 70             | Overall strategy score out of 100       |
| `minimum-trades`     | 2        | Yes      | >= 30             | Total trades executed during backtest   |
| `maximum-drawdown`   | 3        | Yes      | < 40%             | Maximum drawdown during backtest        |
| `wfa-consistency`    | 4        | Yes      | < 30% degradation | Walk-forward train/test performance gap |
| `positive-returns`   | 5        | Yes      | > 0%              | Total backtest return must be positive  |
| `correlation-limit`  | 6        | No       | < 0.7             | Correlation with existing deployments   |
| `volatility-cap`     | 7        | No       | < 150% annualized | Annualized strategy volatility          |
| `portfolio-capacity` | 8        | Yes      | < 35 strategies   | Active deployment count limit           |

## Interface

All gates implement `IPromotionGate` from `promotion-gate.interface.ts`:

```typescript
evaluate(
  strategyScore: StrategyScore,
  backtestRun: BacktestRun,
  context?: PromotionGateContext
): Promise<PromotionGateResult>
```

Each result contains: `gateName`, `passed`, `actualValue`, `requiredValue`, `message`, `severity` (`'warning'` |
`'critical'`), and optional `metadata`.

## How to Add a New Gate

1. Create a new `@Injectable()` class in `gates/` implementing `IPromotionGate`. Set `priority` (lower = runs first) and
   `isCritical`.
2. Register the class in the `providers` array of `strategy.module.ts`.
3. Inject it into `PromotionGateService` constructor and add it to the gates array. The constructor auto-sorts by
   priority.

## Gotchas

- A single critical gate failure blocks promotion. Non-critical failures are surfaced as warnings only.
- `PromotionGateContext` provides `existingDeployments`, `currentMarketRegime`, `totalAllocation`, and user `overrides`.
  Gates like `correlation-limit` and `portfolio-capacity` depend on this context.
- If a gate's `evaluate()` throws, the service catches the error and records it as a critical failure.
- All gate evaluations are audit-logged under `AuditEventType.GATE_EVALUATION`.
- Gates are distinct from runtime risk checks (`risk/`). Gates run pre-promotion; risk checks monitor post-live.
