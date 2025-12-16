/**
 * Standardized Cache Policies for TanStack Query
 *
 * This module defines consistent caching strategies across the application.
 * Each policy is optimized for specific data characteristics:
 *
 * - REALTIME: Data that changes frequently (prices, live metrics)
 * - FREQUENT: User data that may change often (orders, holdings)
 * - STANDARD: Regular API data with moderate freshness needs
 * - STABLE: Data that rarely changes (coin metadata, descriptions)
 * - STATIC: Configuration data that almost never changes
 *
 * Time constants:
 * - staleTime: How long data is considered "fresh" (won't refetch)
 * - gcTime: How long inactive data stays in cache (garbage collection)
 * - refetchInterval: Auto-refetch interval (for polling)
 */

// ============================================================================
// Time Constants (in milliseconds)
// ============================================================================

export const TIME = {
  SECONDS: {
    s15: 15_000,
    s30: 30_000,
    s45: 45_000
  },
  MINUTES: {
    m1: 60_000,
    m2: 2 * 60_000,
    m5: 5 * 60_000,
    m10: 10 * 60_000,
    m15: 15 * 60_000,
    m30: 30 * 60_000
  },
  HOURS: {
    h1: 60 * 60_000,
    h24: 24 * 60 * 60_000
  }
} as const;

// ============================================================================
// Cache Policy Types
// ============================================================================

export interface CachePolicy {
  /** Time in ms that data is considered fresh (won't trigger refetch) */
  staleTime: number;
  /** Time in ms to keep unused data in cache */
  gcTime: number;
  /** Optional auto-refetch interval in ms */
  refetchInterval?: number | false;
  /** Whether to continue refetching when window is not focused */
  refetchIntervalInBackground?: boolean;
  /** Whether to refetch when window regains focus */
  refetchOnWindowFocus?: boolean | 'always';
  /** Number of retry attempts on failure */
  retry?: number | boolean;
  /** Delay between retries (ms or function) */
  retryDelay?: number | ((attemptIndex: number, error: Error) => number);
}

// ============================================================================
// Predefined Cache Policies
// ============================================================================

/**
 * REALTIME: For data that changes very frequently
 *
 * Use cases:
 * - Live prices
 * - Real-time metrics
 * - Active trading data
 *
 * Characteristics:
 * - Very short stale time (0-30s)
 * - Short cache time
 * - Frequent auto-refresh
 * - Continues in background
 */
export const REALTIME_POLICY: CachePolicy = {
  staleTime: 0,
  gcTime: TIME.SECONDS.s30,
  refetchInterval: TIME.SECONDS.s45,
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: 'always',
  retry: 1,
  retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000)
};

/**
 * FREQUENT: For user data that may change often
 *
 * Use cases:
 * - User balances
 * - Open orders
 * - Holdings
 * - Watchlist
 *
 * Characteristics:
 * - Short stale time (30s-1min)
 * - Medium cache time
 * - Periodic refresh
 */
export const FREQUENT_POLICY: CachePolicy = {
  staleTime: TIME.SECONDS.s30,
  gcTime: TIME.MINUTES.m5,
  refetchInterval: TIME.MINUTES.m1,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  retry: 2,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000)
};

/**
 * STANDARD: Default policy for most API data
 *
 * Use cases:
 * - List views
 * - Dashboard data
 * - User profile
 *
 * Characteristics:
 * - Medium stale time (1-2 min)
 * - Medium-long cache time
 * - Refetch on focus only
 */
export const STANDARD_POLICY: CachePolicy = {
  staleTime: TIME.MINUTES.m1,
  gcTime: TIME.MINUTES.m10,
  refetchOnWindowFocus: true,
  retry: 2,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000)
};

/**
 * STABLE: For data that rarely changes
 *
 * Use cases:
 * - Coin metadata (name, symbol, description)
 * - Historical chart data
 * - Categories
 * - Exchange information
 *
 * Characteristics:
 * - Long stale time (5+ min)
 * - Long cache time
 * - No auto-refresh
 */
export const STABLE_POLICY: CachePolicy = {
  staleTime: TIME.MINUTES.m5,
  gcTime: TIME.MINUTES.m30,
  refetchOnWindowFocus: false,
  retry: 3,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
};

/**
 * STATIC: For configuration/reference data that almost never changes
 *
 * Use cases:
 * - Algorithm strategies list
 * - Risk levels
 * - Supported exchanges list
 * - Enums and constants
 *
 * Characteristics:
 * - Very long stale time (10+ min)
 * - Very long cache time
 * - Minimal refetching
 */
export const STATIC_POLICY: CachePolicy = {
  staleTime: TIME.MINUTES.m10,
  gcTime: TIME.HOURS.h1,
  refetchOnWindowFocus: false,
  retry: 3,
  retryDelay: 5000
};

/**
 * INFINITE: For data that never needs automatic refresh
 *
 * Use cases:
 * - Reference data fetched once
 * - User-initiated refresh only
 *
 * Characteristics:
 * - Infinite stale time
 * - Long cache time
 * - Manual refresh only
 */
export const INFINITE_POLICY: CachePolicy = {
  staleTime: Infinity,
  gcTime: TIME.HOURS.h24,
  refetchOnWindowFocus: false,
  retry: 3,
  retryDelay: 5000
};

// ============================================================================
// Cache Policy Collection
// ============================================================================

/**
 * Named collection of all cache policies for easy access
 */
export const CACHE_POLICIES = {
  realtime: REALTIME_POLICY,
  frequent: FREQUENT_POLICY,
  standard: STANDARD_POLICY,
  stable: STABLE_POLICY,
  static: STATIC_POLICY,
  infinite: INFINITE_POLICY
} as const;

export type CachePolicyName = keyof typeof CACHE_POLICIES;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a cache policy by name
 */
export function getCachePolicy(name: CachePolicyName): CachePolicy {
  return CACHE_POLICIES[name];
}

/**
 * Merge a base policy with custom overrides
 */
export function mergeCachePolicy(base: CachePolicy, overrides: Partial<CachePolicy>): CachePolicy {
  return { ...base, ...overrides };
}

/**
 * Create a custom cache policy with defaults
 */
export function createCachePolicy(options: Partial<CachePolicy>): CachePolicy {
  return {
    staleTime: TIME.MINUTES.m1,
    gcTime: TIME.MINUTES.m10,
    refetchOnWindowFocus: true,
    retry: 2,
    ...options
  };
}
