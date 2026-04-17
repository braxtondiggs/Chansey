---
description: Grid search parameter optimization with walk-forward validation
globs:
  - 'apps/api/src/optimization/**'
---

# Optimization Module

## Overview

26 files. Grid search parameter optimization with walk-forward validation.

## Entities

- `OptimizationRun`: campaign + progress tracking
- `OptimizationResult`: per-combination with rank

## Config Presets

| Preset   | Iterations | Max Combos | Notes               |
| -------- | ---------- | ---------- | ------------------- |
| DEFAULT  | 100        | 75         | Standard            |
| FAST     | —          | 20         | Quick validation    |
| THOROUGH | —          | 5000       | Composite objective |

## GridSearchService

Cartesian product → constraint filtering → random-sample if exceeding `maxCombinations` → baseline always index 0.

## ParameterSpaceBuilder

Auto-derives from algorithm's `getConfigSchema()`. Excludes:
`enabled, riskLevel, cooldownMs, maxTradesPerDay, minSellPercent`.

## Recovery

`OptimizationRecoveryService` (`OnApplicationBootstrap`): auto-resumes RUNNING/PENDING at boot (max 3 retries, 6-hour
stale threshold).

## Processor

`OptimizationProcessor`: lock duration 4h, extends lock every 30min, calls `global.gc()` on completion.

## Events

Emits `PIPELINE_EVENTS.OPTIMIZATION_COMPLETED/FAILED` via `EventEmitter2`.

## BullMQ

Queue: `optimization` (concurrency via `OPTIMIZATION_CONCURRENCY` env, default 3).

## Key Constants

- `ZERO_TRADE_PENALTY = -10` for combinations producing no trades
