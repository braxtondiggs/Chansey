---
description: Database migrations — naming conventions, timestamp rules, UUID generation
globs:
  - 'apps/api/src/migrations/**'
---

# Migrations

## Naming Convention

`{13-digit-unix-epoch-ms}-{kebab-case-description}.ts`

Example: `1748500000000-create-failed-job-logs.ts`

## Timestamp Rules

- Use `Date.now()` to generate timestamps
- Always verify with `ls apps/api/src/migrations/` to find the latest timestamp before naming your file

## UUID Generation

**Always use `gen_random_uuid()`** — never `uuid_generate_v4()`.

The `uuid-ossp` extension is not available. `gen_random_uuid()` is built into PostgreSQL 13+ natively.

## Database Config

- Uses `pgcrypto` extension
- `migrationsRun: true` in production only
- `synchronize: true` in non-prod (migrations not auto-run in dev)

## Current State

53 migration files as of last count.

## Table Name Reference

Table naming is **inconsistent** — some are singular, some plural. Always check this list before writing migrations.

### Singular tables (18) — DO NOT pluralize these

Implicit (`@Entity()` — class name → snake_case):

| Entity Class           | Table Name                |
| ---------------------- | ------------------------- |
| `User`                 | `user`                    |
| `Coin`                 | `coin`                    |
| `Risk`                 | `risk`                    |
| `Exchange`             | `exchange`                |
| `ExchangeKey`          | `exchange_key`            |
| `ExchangeKeyHealthLog` | `exchange_key_health_log` |
| `Order`                | `order`                   |
| `Notification`         | `notification`            |
| `Category`             | `category`                |
| `HistoricalBalance`    | `historical_balance`      |
| `TickerPairs`          | `ticker_pairs`            |
| `Algorithm`            | `algorithm`               |

Explicit `@Entity('name')` but still singular:

| Table Name             | Entity Class         |
| ---------------------- | -------------------- |
| `coin_selection`       | `CoinSelection`      |
| `push_subscription`    | `PushSubscription`   |
| `exchange_symbol_map`  | `ExchangeSymbolMap`  |
| `trading_state`        | `TradingState`       |
| `security_audit_log`   | `SecurityAuditLog`   |
| `order_status_history` | `OrderStatusHistory` |

### Plural tables (33)

`algorithm_activations`, `algorithm_performances`, `audit_logs`, `backtests`, `backtest_performance_snapshots`,
`backtest_runs`, `backtest_signals`, `backtest_trades`, `comparison_reports`, `comparison_report_runs`, `deployments`,
`drift_alerts`, `failed_job_logs`, `live_trading_signals`, `market_data_sets`, `market_regimes`, `ohlc_candles`,
`optimization_results`, `optimization_runs`, `paper_trading_accounts`, `paper_trading_orders`, `paper_trading_sessions`,
`paper_trading_signals`, `paper_trading_snapshots`, `performance_metrics`, `pipelines`, `position_exits`,
`opportunity_sell_evaluations`, `simulated_order_fills`, `strategy_configs`, `strategy_scores`,
`user_strategy_positions`, `walk_forward_windows`

### Common mistakes

- `users` → **wrong**. Actual: `user`
- `orders` → **wrong**. Actual: `order`
- `coins` → **wrong**. Actual: `coin`
- `exchanges` → **wrong**. Actual: `exchange`
- `algorithms` → **wrong**. Actual: `algorithm`
- `categories` → **wrong**. Actual: `category`
- `notifications` → **wrong**. Actual: `notification`
- `coin_selections` → **wrong**. Actual: `coin_selection`
