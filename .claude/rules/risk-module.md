---
description: Risk module — risk levels, custom risk, coin count configuration
globs:
  - "apps/api/src/risk/**"
---

# Risk Module

## Overview

Standard CRUD module (controller, service, entity, DTOs). No subdirectories.

## Risk Entity

- `level` (1-6), `name`, `description`, `coinCount` (default 10), `selectionUpdateCron` (nullable)

## Key Constants

From `@chansey/api-interfaces` (not local):

| Constant | Value | Meaning |
|----------|-------|---------|
| `CUSTOM_RISK_LEVEL` | 6 | Manual coin selection (no auto-pick) |
| `DEFAULT_RISK_LEVEL` | 1 | Default for new users |
| `MIN_TRADING_COINS` | — | Minimum coins required to trade |

## Important Behaviors

- `findByLevel()` returns `null` (does not throw) — callers must handle missing
- Level 6 means the user manually manages their coin selections
- Levels 1-5 drive auto-selection behavior and pipeline stage configs

## Risk-Based Configuration

Determines pipeline stage behavior:

| Risk Level | Paper Trading | Training Period | Max Drawdown |
|------------|---------------|-----------------|--------------|
| 1 (Conservative) | 14 days | 180 days | 15% |
| 3 (Moderate) | 7 days | 90 days | 25% |
| 5 (Aggressive) | 3 days | 30 days | 40% |
