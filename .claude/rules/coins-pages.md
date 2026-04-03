---
description: Coin detail page — price chart, market stats, holdings, external links
globs:
  - "apps/chansey/src/app/coins/**"
---

# Coins Pages

## Overview

12 files. Coin detail page at `/app/coins/:slug` with smart/presentational split.

## Smart Component

`CoinDetailComponent`: receives `slug` via `withComponentInputBinding()`, injects `CoinDetailQueries`, passes data down.

## CoinDetailQueries

`@Injectable()` at component level (NOT `providedIn: 'root'`). Returns TanStack query configs.

4 queries:
- detail (STANDARD_POLICY)
- price (REALTIME ~45s)
- history (STABLE, 15min gcTime)
- holdings (FREQUENT, auth-gated)

## Presentational Sub-Components

| Component | Purpose |
|-----------|---------|
| `PriceChartComponent` | Chart.js, custom `hoverLine` plugin, LTTB decimation (150 samples), green/red coloring |
| `MarketStatsComponent` | 3-column grid, `[appCounter]` directive, supply progress bar |
| `HoldingsCardComponent` | Amount, value, avg buy price, P&L, per-exchange breakdown |
| `ExternalLinksComponent` | Website, explorer, Reddit, GitHub, forum links from `CoinLinksDto` |
