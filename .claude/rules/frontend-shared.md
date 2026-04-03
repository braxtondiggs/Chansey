---
description: Frontend shared — reusable components, services, pipes, directives, trading utilities
globs:
  - "apps/chansey/src/app/shared/**"
---

# Frontend Shared

## Overview
80 files. Reusable components, services, pipes, directives, and utilities shared across the Angular frontend.

## Directory Layout
```
shared/
├── components/           # Reusable UI components
├── services/             # Singleton services (providedIn: 'root')
├── pipes/                # Transform pipes
├── directives/           # Attribute directives
├── utils/                # Pure utility functions
└── trading/              # Trading-specific query/mutation/state/utils
```

## Available Components (check before creating new ones)
- **Auth**: `auth-page-shell`, `auth-messages`, `auth-illustrations` (login/register/forgot)
- **Trading**: `crypto-trading` (full widget: order-form, order-book, active-orders, exit-config), `crypto-table` (feature-rich coin table)
- **Data**: `exchange-balance` (chart + history), `recent-transactions`, `user-assets`
- **Forms**: `risk-profile-form`, `image-crop`, `password-requirements`
- **Shell**: `empty-state`, `getting-started` (3-step onboarding), `lazy-image`, `pwa-toast`, `timeout-warning`

## Available Services
- `auth.service.ts`: `useUser()`, `useLogoutMutation()`, `refreshToken()`
- `coin-data.service.ts`: `useCoins()`, `usePrices()`, `useWatchedCoins()`, watchlist/trading coin mutations, `useCoinPreview()`
- `exchange.service.ts`: `useSupportedExchanges()`, `useSaveExchangeKeysMutation()`, `buildExchangeForms()`
- `layout.service.ts`: Theme config, `isDarkTheme()`, localStorage persistence
- `trading/`: Query, mutation, state, utils services for order flow
- `pwa.service.ts`, `session-activity.service.ts`, `title.service.ts`

## Available Pipes
- `formatLargeNumber`: Formats to T/B/M/K suffixes
- `timeAgo`: Relative time display

## Available Directives
- `appCounter`: Animated number counting with easing

## Available Utilities
- `createExternalChartTooltip()`: Custom chart tooltip factory
- `filterCoinSuggestions()`: Autocomplete filter helper
- Order format/severity helpers

## Conventions
- All services use `providedIn: 'root'` — no need to add to module providers
- Use `decimal.js` for all financial math — never native JS floats
- PrimeNG only — no Material or Bootstrap components
- Standalone components with `OnPush` change detection

## How to Add a New Shared Component
1. Create standalone component in `components/`
2. Use `OnPush` change detection + Angular Signals
3. Follow existing naming: `<purpose>.component.ts`
4. Export from component's directory (no barrel files needed — standalone)

## Gotchas
- Check the component/service inventory above before creating anything new — it may already exist
- `decimal.js` is required for financial calculations — PRs using `Number` for money will be rejected
- Services are tree-shaken via `providedIn: 'root'` — don't manually register them in modules
- The `trading/` subdirectory has its own service organization (query, mutation, state, utils) — follow that pattern for trading features
