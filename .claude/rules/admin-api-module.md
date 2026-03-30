---
description: Admin API — trading kill switch, backtest monitoring, live trade analytics
globs:
  - "apps/api/src/admin/**"
---

# Admin API Module

## Sub-Modules

### `trading-state/`
- Global kill switch — singleton entity (one row in DB)
- `isTradingEnabled()` is **synchronous** (in-memory cache) — hot path for every trade
- `haltTrading()` supports `pauseDeployments` + `cancelOpenOrders` flags
- All actions audit-logged as `MANUAL_INTERVENTION`

### `backtest-monitoring/`
- Read-only analytics over backtest/optimization/paper-trading data

### `live-trade-monitoring/`
- Live trade analytics, alerts, slippage analysis
- Alert thresholds: `sharpeRatioWarning=25`, `maxDrawdownWarning=25`

## Constants

- `MAX_EXPORT_LIMIT = 10000` — caps CSV/JSON exports

## Dependencies

- Uses `forwardRef()` for `OrderModule`, `StrategyModule`, `TasksModule`

## Notes

- Frontend admin pages have their own rule file (`admin-pages.md`)
- The trading state in-memory cache means changes take effect immediately without DB round-trip on read
