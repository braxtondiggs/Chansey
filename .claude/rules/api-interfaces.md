---
description: Shared TypeScript interfaces and contracts between API and frontend
globs:
  - "libs/api-interfaces/**"
---

# API Interfaces

## Overview

20+ folders in `libs/api-interfaces/src/lib/`. Shared TypeScript contracts between API and frontend.

## Import Path

Consumed via `@chansey/api-interfaces` path alias.

## Naming Conventions

- Files: `<domain>.<type>.ts` (e.g., `coin.interface.ts`, `order-side.enum.ts`)
- Interfaces: `I` prefix for user models (`IUser`); plain names for DTOs (`Order`, `Coin`)
- Enums: PascalCase, standalone `.enum.ts` or inline
- Constants: `SCREAMING_SNAKE_CASE`

## Barrel Exports

**WITH** barrel `index.ts`: auth, balance, category, coin-selection, notification, order, paper-trading, pipeline, risk, user.

**WITHOUT** (import by path): admin, algorithm, audit, backtesting, coin, constants, exchange, market, strategy.

## Key Interfaces

| Interface | Notes |
|-----------|-------|
| `IUser` | OIDC + trading config |
| `PipelineDetail` | Most complex — 5-stage |
| `Risk` | Helper functions + constants |
| `NotificationPreferences` | Channels, events, quiet hours |
| `CoinDetailResponseDto` | Hybrid public/private |

## Logic Files

Some folders contain pure logic + spec tests (e.g., `pipeline/allocation-limits.ts`).

## Root Export

`api-interfaces.ts` only exports `Message` + `backtesting` — most consumption via folder imports.
