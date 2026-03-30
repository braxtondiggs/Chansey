---
description: App layout shell — sidebar, topbar, breadcrumbs, search, theme configuration
globs:
  - "apps/chansey/src/app/layout/**"
---

# Layout

## Overview

16 files. Two layout variants: `AppLayout` (authenticated shell) and `AuthLayout` (bare auth pages).

## AppLayout

Sidebar + topbar + breadcrumb + footer. `containerClass()` maps 7 menu modes to CSS classes.

## Components

| Component | Details |
|-----------|---------|
| `AppTopBar` | Hamburger, search, notifications (All/Unread/Critical tabs + badge), profile dropdown (DiceBear `funEmoji` fallback) |
| `AppSidebar` | Hover-expand/collapse (300ms debounce), anchor to pin |
| `AppMenu` | "Trading" (5 routes) + "Admin" (9 routes, role-gated) |
| `AppMenuitem` | `[chansey-menuitem]` attribute selector, recursive, animations, hover-open for compact/slim modes |
| `AppBreadcrumb` | Auto from `route.data['breadcrumb']`, `?from=` parent crumb injection |
| `AppSearch` | Coin autocomplete dialog (max 10), navigates to `/app/coins/:slug` |
| `AppRightMenu` | Right drawer for trading, `?trading=open` query param, lazy `CryptoTradingComponent` |
| `AppConfigurator` | PrimeNG `$t()` live theme switch, updates `meta[name="theme-color"]` |

## Services

- `NotificationFeedService`: `providedIn: 'root'`, feed/unread queries, mark-read mutations
- `LayoutService`: `layoutConfig` + `layoutState` signals, mutations via `.update()`

## Theme Utils

- `preset-utils.ts`: semantic token config, special `'noir'` handling
- `surface-palettes.ts`: 8 palettes (slate, gray, zinc, neutral, stone, soho, viva, ocean)

## Gotcha

`surface-palettes.ts` duplicates `settings.constants.ts` — must stay in sync.
