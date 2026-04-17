---
description: Risk module — risk levels, custom risk, coin count configuration
globs:
  - 'apps/api/src/risk/**'
---

# Risk Module

## Overview

Standard CRUD module (controller, service, entity, DTOs). No subdirectories.

## Risk Entity

- `level` (1-6), `name`, `description`, `coinCount` (default 10), `selectionUpdateCron` (nullable)

## Key Constants

From `@chansey/api-interfaces` (not local):

| Constant             | Value | Meaning                              |
| -------------------- | ----- | ------------------------------------ |
| `CUSTOM_RISK_LEVEL`  | 6     | Manual coin selection (no auto-pick) |
| `DEFAULT_RISK_LEVEL` | 3     | Default for new users (Moderate)     |
| `MIN_TRADING_COINS`  | —     | Minimum coins required to trade      |

## Important Behaviors

- `findByLevel()` returns `null` (does not throw) — callers must handle missing
- Level 6 means the user manually manages their coin selections
- Levels 1-5 drive auto-selection behavior and pipeline stage configs

## Risk-Based Configuration

Pipeline stage behavior per risk level. Source of truth: `apps/api/src/tasks/dto/pipeline-orchestration.dto.ts`.

Paper trading completes when `minTrades` is hit (primary gate). `30d` is a uniform hard time cap — not a per-level
duration.

| Level | Description        | Min Trades | Train Days | Max Drawdown |
| ----- | ------------------ | ---------- | ---------- | ------------ |
| 1     | Conservative       | 50         | 180        | 15%          |
| 2     | Low-Moderate       | 45         | 150        | 20%          |
| 3     | Moderate (default) | 40         | 120        | 25%          |
| 4     | Moderate-High      | 35         | 90         | 35%          |
| 5     | Aggressive         | 30         | 60         | 40%          |

Sessions terminate early (as COMPLETED with `stoppedReason=insufficient_signals`) if the risk-band signal check fires:
Level 1 @ day 7 / <3 trades, Level 2 @ day 6 / <3, Level 3-4 @ day 5 / <2, Level 5 @ day 4 / <2.
