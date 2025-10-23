# Research: Cryptocurrency Detail Page

**Date**: 2025-10-22
**Feature**: 004-create-a-dedicated

## Research Questions & Resolutions

### 1. CoinGecko API Integration for Detail Page Data

**Question**: What CoinGecko API endpoints provide the comprehensive market data needed for the detail page (price, history, description, links)?

**Decision**: Use CoinGecko `/coins/{id}` endpoint with specific parameters
- Endpoint: `GET /coins/{id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
- Returns: Current price, market cap, volume, supply, description, links (website, whitepaper, social media)
- For price history: `GET /coins/{id}/market_chart?vs_currency=usd&days={1|7|30|365}`

**Rationale**:
- Single endpoint provides most needed data (description, links, current stats)
- Separate market_chart endpoint for historical data allows efficient caching by time period
- CoinGecko's free tier allows 50 calls/minute - sufficient with Redis caching (5min TTL)
- Coin ID (slug) matches our existing database structure

**Alternatives Considered**:
- CoinMarketCap API: More restrictive free tier (333 calls/day vs 10k calls/day CoinGecko)
- Multiple CoinGecko endpoints: Unnecessary complexity when single endpoint provides most data
- Real-time WebSocket: Overkill for 30-60s refresh requirement, adds complexity

**Implementation Notes**:
- Cache CoinGecko responses in Redis with 5-minute TTL
- Existing `coin.entity.ts` already has `coinGeckoId` field - use as API parameter
- Store description and links in database on first fetch, refresh daily via background job

---

### 2. Chart Library for Price History Visualization

**Question**: Which charting library integrates best with Angular 19 and PrimeNG for displaying cryptocurrency price history?

**Decision**: Use PrimeNG's Chart component (wrapper for Chart.js)

**Rationale**:
- Already included in project dependencies - no bundle size increase
- Consistent with PrimeNG design system used throughout app
- Chart.js well-maintained, 60k+ GitHub stars, excellent documentation
- Supports responsive design, touch interactions (mobile-first requirement)
- Line charts with time-series data are native use case
- Customizable tooltips, legends, time period selector integration

**Alternatives Considered**:
- ApexCharts Angular: Popular but adds 300KB to bundle (violates <500KB constraint)
- D3.js: Too low-level, requires custom implementation, steep learning curve
- ng2-charts: Redundant when PrimeNG already wraps Chart.js
- Lightweight-charts (TradingView): Overkill for simple price history, 180KB addition

**Implementation Notes**:
- Time period selector: PrimeNG TabView component (24h, 7d, 30d, 1y tabs)
- Chart configuration: Line chart, grid lines, responsive: true, maintainAspectRatio: false
- Color scheme: Green for positive change, red for negative (financial convention)
- Data structure: `{ labels: timestamps[], datasets: [{ data: prices[] }] }`

---

### 3. User Holdings Calculation Strategy

**Question**: How do we efficiently aggregate user holdings across multiple exchanges for a single coin?

**Decision**: Extend existing order sync infrastructure, query at page load time

**Rationale**:
- Existing `order.entity.ts` already tracks user orders by coin symbol
- Existing order sync job (hourly) keeps data fresh enough for detail page
- Query pattern: JOIN orders with exchanges filtered by userId + coinSymbol
- Calculate: SUM(order.amount WHERE order.side='buy') - SUM(order.amount WHERE order.side='sell')
- Real-time sync not needed (30-60s refresh aligns with hourly order sync)

**Alternatives Considered**:
- Separate holdings table: Premature optimization, adds complexity and sync issues
- Real-time exchange API calls: Violates exchange rate limits, slow page load
- Cache holdings in Redis: Orders already in PostgreSQL with indexes, query is fast enough

**Implementation Notes**:
- Add `getHoldingsByCoin(userId: string, coinSymbol: string)` to order.service.ts
- Single query with JOIN: orders → exchange_keys → users
- Index on (user_id, symbol) if not already present
- Return: { totalAmount, averageBuyPrice, exchanges: [{ name, amount }] }

---

### 4. Frontend State Management Pattern

**Question**: What TanStack Query patterns ensure efficient data fetching with auto-refresh and time period switching?

**Decision**: Use separate queries for static data vs. dynamic data with different stale times

**Query Structure**:
```typescript
// Static data (description, links) - long stale time
useCoinDetailQuery(slug) → staleTime: 1 hour

// Dynamic data (price, market stats) - short stale time, auto-refetch
useCoinPriceQuery(slug) → refetchInterval: 45 seconds, staleTime: 30 seconds

// Historical data - keyed by time period
useCoinHistoryQuery(slug, period) → staleTime: 5 minutes

// User holdings (authenticated only)
useUserHoldingsQuery(slug) → enabled: !!user, staleTime: 1 minute
```

**Rationale**:
- Separating queries prevents unnecessary refetches (description doesn't change every 30s)
- TanStack Query's automatic background refetching handles 30-60s requirement
- Time period as query key enables instant switching (cached previous periods)
- Conditional holdings query only runs for authenticated users

**Alternatives Considered**:
- Single query for all data: Wasteful, refetches static data unnecessarily
- Manual setInterval: Duplicates TanStack Query functionality, harder to test
- RxJS observables: Overkill, TanStack Query handles this pattern natively

**Implementation Notes**:
- Add visual refresh indicator: TanStack Query `isFetching` state
- Optimistic updates: Not needed (read-only page)
- Error handling: TanStack Query `error` state → display retry button
- Loading states: Skeleton screens via PrimeNG Skeleton component

---

### 5. URL Slug to Coin ID Mapping

**Question**: How do we map URL slugs (e.g., `/coins/bitcoin`) to database records and CoinGecko IDs?

**Decision**: Add indexed `slug` field to Coin entity, generate from name on creation

**Rationale**:
- Existing Coin entity already has `coinGeckoId` field matching CoinGecko's ID format
- Many coins already have coinGeckoId = slug (e.g., "bitcoin", "ethereum")
- Add separate `slug` field for URL routing (more explicit, handles edge cases)
- Database lookup: `SELECT * FROM coins WHERE slug = :slug` - fast with index
- Migration: Populate slug field from coinGeckoId or generate from name

**Alternatives Considered**:
- Use coinGeckoId directly: Works for most coins but not all (some have numeric IDs)
- Numeric coin.id in URL: Not user-friendly, doesn't meet requirement for readable URLs
- Lookup table: Overkill, adds JOIN complexity for simple mapping

**Implementation Notes**:
- TypeORM migration: Add `slug` column with unique index
- Slug generation: `name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`
- Validation: Ensure slug is unique before saving
- Fallback: If slug not found, return 404 with helpful message

---

## Summary of Technical Decisions

| Decision Area | Technology/Pattern | Rationale |
|---------------|-------------------|-----------|
| **Market Data API** | CoinGecko `/coins/{id}` + `/market_chart` | Best free tier, comprehensive data, existing integration |
| **Charting** | PrimeNG Chart (Chart.js wrapper) | Already in dependencies, consistent UI, mobile-friendly |
| **Holdings Calculation** | Query existing orders table | Reuse existing sync infrastructure, no new entities |
| **State Management** | TanStack Query with split queries | Efficient caching, auto-refresh, time period optimization |
| **URL Routing** | Slug field in Coin entity | SEO-friendly, readable, indexed for fast lookup |
| **Caching Strategy** | Redis 5min TTL for CoinGecko data | Respects rate limits, balance freshness vs. performance |
| **Refresh Pattern** | TanStack Query refetchInterval 45s | Meets 30-60s requirement, automatic, testable |

---

## Dependencies & Best Practices

### CoinGecko API Best Practices
- Always include `localization=false` to reduce response size
- Cache responses aggressively (5min for price data, 1 day for metadata)
- Handle rate limits gracefully: 429 status → use cached data + warning
- Monitor monthly API usage (10k requests/month free tier)

### Angular 19 + TanStack Query Best Practices
- Use `injectQuery()` function for type safety and Angular 19 signals compatibility
- Destructure query result: `const { data, isLoading, error, isFetching } = query`
- Handle loading states with PrimeNG Skeleton components
- Use `queryClient.invalidateQueries()` sparingly (auto-refetch handles most cases)

### Performance Best Practices
- Lazy load chart library: `import('chart.js')` only when chart is in viewport
- Use Angular's OnPush change detection for price components
- Debounce time period switching (prevent rapid API calls)
- Implement virtual scrolling for long lists (future: if holdings include many exchanges)

---

## Phase 0 Complete
All technical unknowns resolved. Ready to proceed to Phase 1 (Design & Contracts).
