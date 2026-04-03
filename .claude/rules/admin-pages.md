---
description: Admin pages — algorithm monitoring, backtest dashboards, CRUD management
globs:
  - "apps/chansey/src/app/pages/admin/**"
---

# Admin Pages

## Overview
68 files. Admin-only pages for monitoring algorithms, backtests, live trades, and managing platform entities.

## Directory Layout
```
admin/
├── algorithms/            # Algorithm detail + 7 sub-components
├── backtest-monitoring/   # Backtest dashboard + 10 sub-components
├── live-trade-monitoring/ # Live trade dashboard + 7 sub-components + types
├── categories/            # Simple CRUD
├── coins/                 # Simple CRUD
├── exchanges/             # Simple CRUD
├── risks/                 # Simple CRUD
├── bull-board/            # BullMQ dashboard embed
└── trading-state/         # Trading state management
```

## Key Patterns
- **Component conventions**: Standalone, `OnPush` change detection, Angular Signals, inline templates for sub-components
- **Data fetching**: TanStack Query via `useAuthQuery()` / `useAuthMutation()`, query keys from `@chansey/shared`
- **Lazy tab pattern**: `computed(() => this.activeTab() === 'X')` gates expensive queries — only fetches data when tab is active
- **Query organization**: `algorithm-detail.queries.ts` uses an injectable query config factory pattern — follow this for complex pages with many queries

## Available PrimeNG Components (commonly used)
`Table`, `Drawer`, `Tag`, `Chart`, `SelectButton`, `Dialog`, `TabView`

## How to Add a New Admin Page
1. Create standalone component in a new subdirectory
2. Use `OnPush` + Signals pattern
3. Fetch data via `useAuthQuery()` with query keys from `@chansey/shared`
4. Add route in admin routing configuration
5. Add navigation link in admin layout/menu

## Gotchas
- All admin pages require authentication — `useAuthQuery`/`useAuthMutation` handle token injection
- Sub-components use inline templates — keep them small and focused
- The lazy tab pattern is important for performance — don't fetch all tab data upfront
- Query keys must be defined in `@chansey/shared` for cache invalidation consistency
