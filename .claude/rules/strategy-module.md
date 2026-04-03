---
description: Strategy lifecycle — shadow status, promotion gates, runtime risk checks, deployments
globs:
  - "apps/api/src/strategy/**"
---

# Strategy Module

## Overview
57 files. Central entity: `StrategyConfig` with a `shadowStatus` lifecycle (`testing → shadow → live → retired`). Contains two distinct validation systems: promotion gates and runtime risk checks.

## Directory Layout
```
strategy/
├── gates/                # 8 promotion gates (IPromotionGate)
├── risk/                 # 6 runtime risk checks (IRiskCheck)
├── entities/             # StrategyConfig, Deployment, BacktestRun, WalkForwardWindow, PerformanceMetric
├── services/             # Promotion, deployment, pre-trade risk
└── strategy.module.ts
```

## Key Patterns
- **Gates vs Risk Checks** — two separate systems:
  - **Gates** (`gates/`): Pre-promotion quality barriers. Implement `IPromotionGate.evaluate()`. 8 gates sorted by priority. A critical gate failure blocks promotion entirely.
  - **Risk Checks** (`risk/`): Post-live hourly monitoring. Implement `IRiskCheck.evaluate()`. 6 checks. The `autoDemote` flag triggers automatic demotion on critical severity.
- **PreTradeRiskGateService**: Real-time per-trade drawdown gate — distinct from the hourly risk checks
- **Shadow status lifecycle**: `testing → shadow → live → retired` — transitions are gate-controlled

## Entity Relationships
- `StrategyConfig` → `BacktestRun` → `WalkForwardWindow`
- `StrategyConfig` → `Deployment` → `PerformanceMetric`
- `Deployment` has computed getters: `isActive`, `winRate`, `totalPnl` + embedded risk limits

## How to Add a New Gate
1. Create class in `gates/` implementing `IPromotionGate`
2. Set `priority` (lower = runs first) and `critical` flag
3. Register in module providers
4. The promotion service auto-discovers gates via DI

## How to Add a New Risk Check
1. Create class in `risk/` implementing `IRiskCheck`
2. Set `autoDemote` flag if the check should trigger automatic demotion
3. Register in module providers

## Gotchas
- Gates block promotion; risk checks monitor post-promotion — don't confuse the two
- `PreTradeRiskGateService` runs per-trade in real-time, not on the hourly schedule
- `Deployment` computed getters (`winRate`, etc.) derive from `PerformanceMetric` — don't duplicate the calculation
