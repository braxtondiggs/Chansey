---
description: 5-stage validation pipeline — optimize, historical, live replay, paper trade, completed
globs:
  - 'apps/api/src/pipeline/**'
---

# Pipeline Module

## Overview

19 files. Orchestrates the 5-stage validation pipeline: `OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADE → COMPLETED`.

## Event-Driven Architecture

Uses `EventEmitter2` + `PIPELINE_EVENTS` constants — no direct cross-module method calls for completion.

`PipelineEventListener` handles: `optimization.completed/failed`, `backtest.completed`, `paper-trading.completed`.

## Stage Promotion Logic

| Transition                | Gate                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| OPTIMIZE → HISTORICAL     | `improvement >= 3%`                                                        |
| HISTORICAL → LIVE_REPLAY  | Auto-advances unconditionally                                              |
| LIVE_REPLAY → PAPER_TRADE | Score-gated via `ScoringService.calculatePipelineScore()` (min score 30)   |
| PAPER_TRADE → COMPLETED   | `StageProgressionThresholds`: minSharpe 0.3, maxDrawdown 0.45, minReturn 0 |

## Entity

Pipeline has nullable FK per stage. `PipelineStageConfig` stored as JSONB.

## BullMQ

Queue: `pipeline` (concurrency 3, 1-hour timeout).

## API

Controller: admin-only at `/admin/pipelines`.

## Dependencies

Heavy `forwardRef()` zone — circular deps with Algorithm, Auth, Optimization, Order, PaperTrading, Scoring,
MarketRegime, CoinSelection modules.

## User Isolation Model

Pipelines and backtests are **strictly user-specific**. Each has a mandatory `user` FK with cascade delete. Users cannot
see each other's results — all queries filter by `user.id`.

### What Makes Each Run Unique

| Factor             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| User               | Each run belongs to one user                          |
| Algorithm          | Which trading strategy to use                         |
| Strategy Params    | User-specific parameter overrides                     |
| Market Data Set    | Which historical data to backtest against             |
| Date Range         | Start/end dates for the backtest period               |
| Initial Capital    | Starting portfolio value                              |
| Trading Fee        | Commission percentage                                 |
| Slippage Model     | How to simulate execution slippage                    |
| Risk Level (1-5)   | User's risk profile drives all pipeline stage configs |
| Exchange Key       | User's specific exchange credentials                  |
| Deterministic Seed | For reproducibility                                   |

### Shared vs User-Specific Resources

| Shared (Global)  | User-Specific                      |
| ---------------- | ---------------------------------- |
| Algorithms       | Strategy Configs (param overrides) |
| Market Data Sets | Exchange Keys                      |
|                  | Backtests & Pipelines              |
|                  | Risk Profile                       |

## Key Constants

- `PIPELINE_EVENTS` — all event names
- `StageProgressionThresholds` — configurable per risk level
