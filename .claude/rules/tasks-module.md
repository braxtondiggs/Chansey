---
description: Scheduled background tasks — performance calc, pipelines, backtests, risk monitoring
globs:
  - "apps/api/src/tasks/**"
---

# Tasks Module

## Overview

23 files. Top-level scheduled tasks orchestrating cross-module background work.

## Task Schedule (all UTC)

| Task | Schedule | Purpose |
|------|----------|---------|
| `PerformanceCalcTask` | 1AM daily | P&L, Sharpe, drawdown for deployments |
| `PipelineOrchestrationTask` | 2:30AM daily | Validation pipelines (offset from 2AM top-of-hour burst) |
| `PromotionTask` | 2AM daily | Evaluate validated strategies for live deployment |
| `BacktestOrchestrationTask` | 3AM daily | Auto backtests + watchdog for stuck runs |
| `RedisMaintenanceTask` | 4AM daily | Trim BullMQ job sets, event streams (ioredis to DB 3) |
| `MarketRegimeTask` | Hourly | BTC/ETH/SOL/POL regime detection |
| `RiskMonitoringTask` | Hourly | Deployment risk threshold checks |
| `StrategyEvaluationTask` | Every 6h | Evaluate `TESTING` status strategies |
| `DriftDetectionTask` | Every 6h | Multi-dimensional drift detection |

## Pattern

Tasks schedule BullMQ jobs; processing happens in separate `*Processor` classes.

## Staggering

Per-user jobs delayed by `STAGGER_INTERVAL_MS` (1 min) to avoid thundering herd.

## Eligibility

`getEligibleUsers()` requires `algoTradingEnabled = true` + active `ExchangeKey`.

## Watchdog

`BacktestOrchestrationTask` detects stale runs (90min/120min/6h thresholds) and emits `PIPELINE_EVENTS`.

## Risk Config

`buildStageConfigFromRisk()` generates pipeline config per risk level (1-5).
