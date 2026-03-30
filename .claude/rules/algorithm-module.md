---
description: Trading algorithms — 13 strategies, indicator service, registry pattern
globs:
  - "apps/api/src/algorithm/**"
---

# Algorithm Module

## Overview
79 files containing 13 trading strategies extending `BaseAlgorithmStrategy`. Uses a registry pattern to map strategy IDs to instances at runtime.

## Directory Layout
```
algorithm/
├── strategies/           # 13 concrete strategy implementations
├── indicators/           # IndicatorService + 8 calculators
├── algorithm.registry.ts # Maps strategyId → strategy instance
├── entities/             # Algorithm entity + related
├── scripts/              # LEGACY seeding — not runtime code
└── algorithm.module.ts
```

## Key Patterns
- **Inheritance chain**: `AlgorithmStrategy` (interface) → `BaseAlgorithmStrategy` (abstract) → concrete strategies
- **Registry**: `AlgorithmRegistry` maps `strategyId` → strategy instance. Registration happens in module factory provider `ALGORITHM_STRATEGIES_INIT`
- **Strategy IDs**: kebab-case with numeric suffix (e.g., `'rsi-momentum-001'`, `'confluence-001'`)
- **Indicator caching**: `IndicatorService` has L1 (in-memory) / L2 (Redis) caching. 8 calculators: RSI, EMA, SMA, MACD, Bollinger, ATR, StdDev, plus composite
- **Backtest fast-path**: `getPrecomputedSlice()` avoids Redis during simulation — use this instead of live indicator calls in backtest context

## How to Add a New Strategy
1. Create class in `strategies/` extending `BaseAlgorithmStrategy`
2. Add to module `providers` array
3. Add to `ALGORITHM_STRATEGIES_INIT` factory so it registers in `AlgorithmRegistry`
4. Insert corresponding DB row in `algorithm` table with matching `strategyId`

## Available Calculators
`RSI`, `EMA`, `SMA`, `MACD`, `BollingerBands`, `ATR`, `StdDev` — all accessible via `IndicatorService`

## Gotchas
- `scripts/` directory is legacy seeding — not used at runtime, don't add new scripts there
- Suppress chart data emission in simulation mode (unnecessary overhead)
- Strategy `evaluate()` must return a signal object, not execute trades directly
- The registry is populated at module init — adding a strategy without registering it will silently fail
