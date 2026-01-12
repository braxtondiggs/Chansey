/**
 * Centralized Query Key Factory
 *
 * This module provides a single source of truth for all TanStack Query keys
 * across the Chansey application. Using a factory pattern ensures consistency,
 * prevents key collisions, and enables efficient cache invalidation.
 *
 * Key Structure Pattern:
 * - Domain: ['domain'] - Root key for the domain
 * - Lists: ['domain', 'list', ...filters] - Collection queries
 * - Detail: ['domain', 'detail', id] - Single entity queries
 * - Nested: ['domain', 'detail', id, 'subresource'] - Related data
 *
 * @example
 * // Using keys in a component
 * const coinsQuery = injectQuery(() => ({
 *   queryKey: queryKeys.coins.list(),
 *   queryFn: () => fetchCoins()
 * }));
 *
 * // Invalidating related queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.coins.all });
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Base query key type - all keys extend from readonly arrays
 */
export type QueryKeyBase = readonly unknown[];

// ============================================================================
// Query Key Factory
// ============================================================================

export const queryKeys = {
  // --------------------------------------------------------------------------
  // Coins Domain
  // --------------------------------------------------------------------------
  coins: {
    all: ['coins'] as const,
    lists: () => [...queryKeys.coins.all, 'list'] as const,
    list: (filters?: { category?: string; search?: string }) =>
      filters ? ([...queryKeys.coins.lists(), filters] as const) : queryKeys.coins.lists(),
    watchlist: () => [...queryKeys.coins.all, 'watchlist'] as const,
    detail: (slug: string) => [...queryKeys.coins.all, 'detail', slug] as const,
    price: (slug: string) => [...queryKeys.coins.detail(slug), 'price'] as const,
    chart: (slug: string, period: string) => [...queryKeys.coins.detail(slug), 'chart', period] as const,
    holdings: (slug: string) => [...queryKeys.coins.detail(slug), 'holdings'] as const
  },

  // --------------------------------------------------------------------------
  // Algorithms Domain
  // --------------------------------------------------------------------------
  algorithms: {
    all: ['algorithms'] as const,
    lists: () => [...queryKeys.algorithms.all, 'list'] as const,
    strategies: () => [...queryKeys.algorithms.all, 'strategies'] as const,
    detail: (id: string) => [...queryKeys.algorithms.all, 'detail', id] as const,
    performance: (id: string) => [...queryKeys.algorithms.detail(id), 'performance'] as const,
    performanceHistory: (id: string, period: string) =>
      [...queryKeys.algorithms.detail(id), 'performance-history', period] as const
  },

  // --------------------------------------------------------------------------
  // Exchanges Domain
  // --------------------------------------------------------------------------
  exchanges: {
    all: ['exchanges'] as const,
    lists: () => [...queryKeys.exchanges.all, 'list'] as const,
    supported: () => [...queryKeys.exchanges.lists(), 'supported'] as const,
    detail: (id: string) => [...queryKeys.exchanges.all, 'detail', id] as const,
    sync: () => [...queryKeys.exchanges.all, 'sync'] as const
  },

  // --------------------------------------------------------------------------
  // Categories Domain
  // --------------------------------------------------------------------------
  categories: {
    all: ['categories'] as const,
    lists: () => [...queryKeys.categories.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.categories.all, 'detail', id] as const
  },

  // --------------------------------------------------------------------------
  // Risks Domain
  // --------------------------------------------------------------------------
  risks: {
    all: ['risks'] as const,
    lists: () => [...queryKeys.risks.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.risks.all, 'detail', id] as const
  },

  // --------------------------------------------------------------------------
  // Transactions (Orders) Domain
  // --------------------------------------------------------------------------
  transactions: {
    all: ['transactions'] as const,
    lists: () => [...queryKeys.transactions.all, 'list'] as const,
    open: () => [...queryKeys.transactions.all, 'open'] as const,
    detail: (id: string) => [...queryKeys.transactions.all, 'detail', id] as const
  },

  // --------------------------------------------------------------------------
  // Balances Domain
  // --------------------------------------------------------------------------
  balances: {
    all: ['balances'] as const,
    current: (exchangeId?: string) =>
      exchangeId
        ? ([...queryKeys.balances.all, 'exchange', exchangeId] as const)
        : ([...queryKeys.balances.all, 'current'] as const),
    withHistory: (period: string, exchangeId?: string) =>
      exchangeId
        ? ([...queryKeys.balances.all, 'history', period, exchangeId] as const)
        : ([...queryKeys.balances.all, 'history', period] as const),
    accountHistory: (days: number) => [...queryKeys.balances.all, 'accountHistory', days.toString()] as const,
    assets: () => [...queryKeys.balances.all, 'assets'] as const
  },

  // --------------------------------------------------------------------------
  // User/Auth Domain
  // --------------------------------------------------------------------------
  auth: {
    all: ['auth'] as const,
    user: () => [...queryKeys.auth.all, 'user'] as const,
    token: () => [...queryKeys.auth.all, 'token'] as const
  },

  // --------------------------------------------------------------------------
  // Profile Domain
  // --------------------------------------------------------------------------
  profile: {
    all: ['profile'] as const,
    detail: () => [...queryKeys.profile.all, 'detail'] as const,
    exchangeKeys: () => [...queryKeys.profile.all, 'exchange-keys'] as const
  },

  // --------------------------------------------------------------------------
  // Backtests Domain
  // --------------------------------------------------------------------------
  backtests: {
    all: ['backtests'] as const,
    lists: () => [...queryKeys.backtests.all, 'list'] as const,
    datasets: () => [...queryKeys.backtests.all, 'datasets'] as const,
    detail: (id: string) => [...queryKeys.backtests.all, 'detail', id] as const,
    signals: (id: string) => [...queryKeys.backtests.detail(id), 'signals'] as const,
    trades: (id: string) => [...queryKeys.backtests.detail(id), 'trades'] as const
  },

  // --------------------------------------------------------------------------
  // Comparison Reports Domain
  // --------------------------------------------------------------------------
  comparisonReports: {
    all: ['comparison-reports'] as const,
    detail: (id: string) => [...queryKeys.comparisonReports.all, 'detail', id] as const
  },

  // --------------------------------------------------------------------------
  // Prices Domain (for simple price lookups)
  // --------------------------------------------------------------------------
  prices: {
    all: ['prices'] as const,
    byIds: (ids: string) => [...queryKeys.prices.all, 'byIds', ids] as const
  },

  // --------------------------------------------------------------------------
  // Trading Domain
  // --------------------------------------------------------------------------
  trading: {
    all: ['trading'] as const,
    tickerPairs: (exchangeId?: string) =>
      exchangeId
        ? ([...queryKeys.trading.all, 'ticker-pair', exchangeId] as const)
        : ([...queryKeys.trading.all, 'ticker-pair', 'all'] as const),
    balances: () => [...queryKeys.trading.all, 'balances'] as const,
    orderBook: (symbol: string) => [...queryKeys.trading.all, 'orderBook', symbol] as const,
    orders: () => [...queryKeys.trading.all, 'orders'] as const,
    activeOrders: () => [...queryKeys.trading.orders(), 'active'] as const,
    orderHistory: () => [...queryKeys.trading.orders(), 'history'] as const,
    estimate: () => [...queryKeys.trading.all, 'estimate'] as const,
    ticker: (symbol: string) => [...queryKeys.trading.all, 'ticker', symbol] as const
  },

  // --------------------------------------------------------------------------
  // Admin Domain
  // --------------------------------------------------------------------------
  admin: {
    all: ['admin'] as const,
    tradingState: () => [...queryKeys.admin.all, 'trading-state'] as const
  }
} as const;

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Extract the type of query keys for type-safe usage
 */
export type QueryKeys = typeof queryKeys;

/**
 * Helper type to get all possible query keys for a domain
 */
export type CoinsQueryKeys = (typeof queryKeys)['coins'];
export type AlgorithmsQueryKeys = (typeof queryKeys)['algorithms'];
export type ExchangesQueryKeys = (typeof queryKeys)['exchanges'];
export type CategoriesQueryKeys = (typeof queryKeys)['categories'];
export type RisksQueryKeys = (typeof queryKeys)['risks'];
export type TransactionsQueryKeys = (typeof queryKeys)['transactions'];
export type BalancesQueryKeys = (typeof queryKeys)['balances'];
export type AuthQueryKeys = (typeof queryKeys)['auth'];
export type ProfileQueryKeys = (typeof queryKeys)['profile'];
export type BacktestsQueryKeys = (typeof queryKeys)['backtests'];
export type ComparisonReportsQueryKeys = (typeof queryKeys)['comparisonReports'];
export type PricesQueryKeys = (typeof queryKeys)['prices'];
export type TradingQueryKeys = (typeof queryKeys)['trading'];
export type AdminQueryKeys = (typeof queryKeys)['admin'];
