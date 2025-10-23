# Data Model: Cryptocurrency Detail Page

**Date**: 2025-10-22
**Feature**: 004-create-a-dedicated

## Entity Modifications

### Coin Entity (EXISTING - EXTEND)

**Location**: `libs/database/entities/coin.entity.ts`

**New Fields to Add**:
```typescript
@Column({ type: 'varchar', length: 100, unique: true, nullable: false })
@Index('idx_coin_slug')
slug: string; // URL-friendly identifier (e.g., 'bitcoin', 'ethereum')

@Column({ type: 'text', nullable: true })
description: string; // Cryptocurrency description from CoinGecko

@Column({ type: 'jsonb', nullable: true })
links: {
  homepage: string[];
  blockchainSite: string[];
  officialForumUrl: string[];
  subredditUrl: string;
  reposUrl: {
    github: string[];
  };
}; // External resource links from CoinGecko

@Column({ type: 'timestamp', nullable: true })
metadataLastUpdated: Date; // Track when description/links were last refreshed
```

**Existing Fields (NO CHANGES)**:
- `id`: Primary key (UUID)
- `name`: Display name (e.g., "Bitcoin")
- `symbol`: Trading symbol (e.g., "BTC")
- `coinGeckoId`: CoinGecko API identifier
- `imageUrl`: Logo URL
- `currentPrice`: Latest price (updated by existing job)
- `priceChange24h`: 24-hour price change percentage
- `marketCap`: Market capitalization
- `volume24h`: 24-hour trading volume
- `circulatingSupply`: Current circulating supply
- `createdAt`, `updatedAt`: Timestamps

**Validation Rules**:
- `slug` must be unique across all coins
- `slug` must match regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (lowercase, hyphens only)
- `description` maximum length: 10,000 characters
- `links` must conform to URL format (validated at application layer)

**Indexes**:
- Add unique index on `slug` (supports `/coins/:slug` route lookup)
- Existing indexes on `symbol`, `coinGeckoId` remain

**Migration Requirements**:
- Add new columns with nullable constraint initially
- Backfill `slug` from `coinGeckoId` or generate from `name`
- Set `nullable: false` for `slug` after backfill
- Add unique constraint on `slug`

---

## DTOs (Data Transfer Objects)

### CoinDetailResponseDto (NEW)

**Location**: `libs/api-interfaces/src/lib/coin.interface.ts`

```typescript
export interface CoinDetailResponseDto {
  // Basic Info
  id: string;
  slug: string;
  name: string;
  symbol: string;
  imageUrl: string;

  // Current Market Data
  currentPrice: number;
  priceChange24h: number;
  priceChange24hPercent: number;

  // Market Statistics
  marketCap: number;
  marketCapRank?: number;
  volume24h: number;
  circulatingSupply: number;
  totalSupply?: number;
  maxSupply?: number;

  // Metadata
  description: string;
  links: CoinLinksDto;

  // User-specific (authenticated only)
  userHoldings?: UserHoldingsDto;

  // Timestamps
  lastUpdated: Date;
  metadataLastUpdated?: Date;
}
```

### CoinLinksDto (NEW)

```typescript
export interface CoinLinksDto {
  homepage: string[];           // Official website URLs
  blockchainSite: string[];     // Blockchain explorer URLs
  officialForumUrl: string[];   // Forum/community URLs
  subredditUrl?: string;         // Reddit community
  repositoryUrl: string[];       // GitHub/GitLab repositories
}
```

### MarketChartResponseDto (NEW)

```typescript
export interface MarketChartResponseDto {
  coinSlug: string;
  period: '24h' | '7d' | '30d' | '1y';
  prices: PriceDataPoint[];
  timestamps: number[];          // Unix timestamps (milliseconds)
  generatedAt: Date;
}

export interface PriceDataPoint {
  timestamp: number;             // Unix timestamp (milliseconds)
  price: number;                 // USD price
}
```

### UserHoldingsDto (NEW)

```typescript
export interface UserHoldingsDto {
  coinSymbol: string;
  totalAmount: number;           // Total holdings across all exchanges
  averageBuyPrice: number;       // Weighted average purchase price
  currentValue: number;          // totalAmount * currentPrice
  profitLoss: number;            // currentValue - (totalAmount * averageBuyPrice)
  profitLossPercent: number;     // (profitLoss / invested) * 100
  exchanges: ExchangeHoldingDto[];
}

export interface ExchangeHoldingDto {
  exchangeName: string;          // e.g., "Binance", "Coinbase"
  amount: number;                // Holdings on this exchange
  lastSynced: Date;              // When this exchange was last synced
}
```

---

## Query Patterns

### Backend (NestJS)

#### Get Coin Detail by Slug
```typescript
// coin.service.ts
async getCoinDetailBySlug(slug: string, userId?: string): Promise<CoinDetailResponseDto> {
  // 1. Query coin from database
  const coin = await this.coinRepository.findOne({ where: { slug } });
  if (!coin) throw new NotFoundException(`Coin with slug '${slug}' not found`);

  // 2. Fetch additional market data from CoinGecko (with caching)
  const marketData = await this.fetchCoinGeckoData(coin.coinGeckoId);

  // 3. If user authenticated, calculate holdings
  let userHoldings: UserHoldingsDto | undefined;
  if (userId) {
    userHoldings = await this.orderService.getHoldingsByCoin(userId, coin.symbol);
  }

  // 4. Merge data and return
  return this.mapToCoinDetailResponse(coin, marketData, userHoldings);
}
```

#### Get Market Chart Data
```typescript
// coin.service.ts
async getMarketChart(slug: string, period: '24h' | '7d' | '30d' | '1y'): Promise<MarketChartResponseDto> {
  // 1. Get coin by slug
  const coin = await this.coinRepository.findOne({ where: { slug } });
  if (!coin) throw new NotFoundException(`Coin with slug '${slug}' not found`);

  // 2. Fetch from CoinGecko with period mapping
  const days = { '24h': 1, '7d': 7, '30d': 30, '1y': 365 }[period];
  const chartData = await this.fetchCoinGeckoMarketChart(coin.coinGeckoId, days);

  // 3. Transform and cache
  return this.mapToMarketChartResponse(coin.slug, period, chartData);
}
```

#### Calculate User Holdings
```typescript
// order.service.ts (EXTEND EXISTING)
async getHoldingsByCoin(userId: string, coinSymbol: string): Promise<UserHoldingsDto> {
  // Query: JOIN orders with exchange_keys, filter by userId and symbol
  const orders = await this.orderRepository
    .createQueryBuilder('order')
    .leftJoin('order.exchangeKey', 'exchangeKey')
    .where('exchangeKey.userId = :userId', { userId })
    .andWhere('order.symbol = :coinSymbol', { coinSymbol })
    .getMany();

  // Calculate totals
  const buys = orders.filter(o => o.side === 'buy');
  const sells = orders.filter(o => o.side === 'sell');
  const totalBought = buys.reduce((sum, o) => sum + o.amount, 0);
  const totalSold = sells.reduce((sum, o) => sum + o.amount, 0);
  const totalAmount = totalBought - totalSold;

  // Calculate average buy price
  const totalInvested = buys.reduce((sum, o) => sum + (o.price * o.amount), 0);
  const averageBuyPrice = totalInvested / totalBought;

  // Group by exchange
  const exchangeHoldings = this.groupHoldingsByExchange(orders);

  return {
    coinSymbol,
    totalAmount,
    averageBuyPrice,
    exchanges: exchangeHoldings,
    // currentValue, profitLoss calculated at application layer with current price
  };
}
```

### Frontend (Angular + TanStack Query)

#### Query Hook Signatures
```typescript
// coin-detail.queries.ts

// Main detail query (static data + current price)
export const useCoinDetailQuery = injectQuery(() => ({
  queryKey: ['coin-detail', slug],
  queryFn: () => apiClient.get<CoinDetailResponseDto>(`/coins/${slug}`),
  staleTime: 60000, // 1 minute
}));

// Price query with auto-refresh (dynamic data)
export const useCoinPriceQuery = injectQuery(() => ({
  queryKey: ['coin-price', slug],
  queryFn: () => apiClient.get<CoinDetailResponseDto>(`/coins/${slug}`),
  refetchInterval: 45000, // 45 seconds
  staleTime: 30000, // 30 seconds
}));

// Market chart query (keyed by time period)
export const useCoinHistoryQuery = injectQuery(() => ({
  queryKey: ['coin-history', slug, period],
  queryFn: () => apiClient.get<MarketChartResponseDto>(`/coins/${slug}/chart?period=${period}`),
  staleTime: 300000, // 5 minutes
}));

// User holdings query (conditional)
export const useUserHoldingsQuery = injectQuery(() => ({
  queryKey: ['coin-holdings', slug],
  queryFn: () => apiClient.get<UserHoldingsDto>(`/coins/${slug}/holdings`),
  enabled: !!userId, // Only fetch if user authenticated
  staleTime: 60000, // 1 minute
}));
```

---

## State Transitions

### Coin Metadata Lifecycle

```
[Initial State: Coin exists, no metadata]
         ↓
[Trigger: User visits detail page for first time]
         ↓
[Action: Fetch description + links from CoinGecko]
         ↓
[State: Metadata populated, metadataLastUpdated set]
         ↓
[Background: Daily job checks metadataLastUpdated]
         ↓
[Condition: If > 24 hours old → refresh from CoinGecko]
         ↓
[State: Metadata refreshed, timestamp updated]
```

### Price Data Lifecycle

```
[Component Mount: Detail page loaded]
         ↓
[Initial Fetch: Load current price + chart for default period (24h)]
         ↓
[State: Data displayed, TanStack Query cache populated]
         ↓
[After 45s: Auto-refetch triggered by refetchInterval]
         ↓
[State: Price updated, visual indicator shown during fetch]
         ↓
[User Action: Switch time period tab (7d, 30d, 1y)]
         ↓
[Query: Fetch chart for new period (or use cached if available)]
         ↓
[State: Chart updated instantly if cached, loading state if fetching]
```

### User Holdings Lifecycle (Authenticated Users Only)

```
[Component Mount: Detail page loaded + user authenticated]
         ↓
[Query: Fetch holdings from orders table]
         ↓
[State: Holdings displayed in separate card]
         ↓
[After 1min: Auto-refetch holdings (may have changed via order sync)]
         ↓
[State: Holdings updated]
         ↓
[Background: Hourly order sync job runs]
         ↓
[Effect: Holdings data becomes stale, will refresh on next refetch]
```

---

## Data Integrity Constraints

### Database Constraints
- `coin.slug` UNIQUE NOT NULL
- `coin.coinGeckoId` should remain unique
- Foreign key: `order.exchangeKeyId` → `exchange_keys.id` (existing)
- Index on `(order.exchangeKeyId, order.symbol)` for holdings queries

### Application-Level Validation
- Slug generation: Must be idempotent (same name → same slug)
- CoinGecko API responses: Validate structure before persisting
- Links: Validate URL format, filter invalid URLs
- Holdings calculation: Handle divide-by-zero (no buys edge case)
- Percentage changes: Handle infinity (no average buy price edge case)

### Caching Constraints
- Redis key format: `coingecko:coin:{coinGeckoId}` (5min TTL)
- Redis key format: `coingecko:chart:{coinGeckoId}:{days}` (5min TTL)
- TanStack Query cache: Per-query stale times defined above
- Cache invalidation: Manual invalidation not needed (TTL sufficient)

---

## Performance Considerations

### Database Query Optimization
- Existing index on `coin.symbol` - used for holdings query
- New index on `coin.slug` - used for detail page lookup
- Holdings query: Single JOIN (orders ← exchange_keys), filtered by userId + symbol
- Expected: <50ms for coin lookup, <100ms for holdings calculation (typical user has <100 orders)

### API Response Size
- CoinGecko coin detail: ~15KB gzipped (includes unnecessary fields filtered out)
- CoinGecko market chart (365 days): ~30KB gzipped (365 data points)
- Our API response: <10KB for detail, <20KB for chart (optimized DTOs)
- Total page load: <50KB API data + components/chart lib

### Caching Strategy
- Redis caching reduces CoinGecko API calls by 90% (5min TTL, avg page view 3min)
- TanStack Query reduces frontend API calls during navigation (stale time > typical session)
- Chart data cached per period - switching periods is instant on second view

---

## Data Model Complete
All entities, DTOs, and query patterns defined. Ready to proceed to contract generation.
