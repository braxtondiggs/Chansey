export const LOCK_KEYS = {
  LIVE_TRADING: 'live-trading:execution-lock',
  OHLC_SYNC_SCHEDULE: 'ohlc-sync:schedule-lock',
  OHLC_GAP_DETECTION: 'ohlc:gap-detection-lock',
  OHLC_GAP_DETECTION_SCHEDULE: 'ohlc:gap-detection-schedule-lock',
  SYMBOL_MAP_REFRESH: 'ohlc-sync:symbol-map-refresh-lock',
  COIN_SYNC: 'coin-sync:lock',
  /** @deprecated Replaced by COIN_MARKET_SYNC / COIN_METADATA_SYNC. Retained for one release so in-flight workers do not error. */
  COIN_DETAIL: 'coin-detail:lock',
  COIN_MARKET_SYNC: 'coin-market-sync:lock',
  COIN_METADATA_SYNC: 'coin-metadata-sync:lock',
  TICKER_PAIRS_SYNC: 'ticker-pairs-sync:lock',
  CATEGORY_SYNC: 'category-sync:lock',
  EXCHANGE_SYNC: 'exchange-sync:lock',
  LISTING_CROSS_LISTING_SEED: 'listing-cross-listing-seed:lock'
} as const;

// INVARIANT: Distributed-lock TTLs here are INDEPENDENT of BullMQ `lockDuration`.
// BullMQ auto-renews its internal worker lock every `lockDuration / 2` ms for as
// long as the worker process is alive — so `lockDuration` only needs to survive
// a single renewal cycle, NOT the total job runtime. Prefer short `lockDuration`
// values (e.g. 60s) so stall detection stays fast for all jobs on the queue.
// The distributed lock (SET NX PX) below is the true barrier against concurrent
// execution, and its TTL should bound the expected job runtime with buffer.
export const LOCK_DEFAULTS = {
  LIVE_TRADING_TTL_MS: 5 * 60 * 1000, // 5 minutes
  SCHEDULE_LOCK_TTL_MS: 30 * 1000, // 30 seconds for scheduling operations
  OHLC_GAP_DETECTION_TTL_MS: 30 * 60 * 1000, // 30 minutes — counting + queueing is fast; lock guards multi-instance scheduling
  COIN_SYNC_TTL_MS: 45 * 60 * 1000, // 45 minutes — observed ~34.8 min, ~30% buffer
  COIN_DETAIL_TTL_MS: 5 * 60 * 60 * 1000, // 5 hours — observed runtime ~3h 46m (1500 coins × 2.5s/batch + 429 retries); ~33% buffer
  COIN_MARKET_SYNC_TTL_MS: 45 * 60 * 1000, // 45 minutes — up to ~25 min on fresh install (500 coins × per-coin chart backfill) + batched markets + snapshot + 30s cooldown, ~80% headroom
  COIN_METADATA_SYNC_TTL_MS: 5 * 60 * 60 * 1000, // 5 hours — monthly per-coin metadata refresh (same budget as former coin-detail)
  TICKER_PAIRS_SYNC_TTL_MS: 30 * 60 * 1000, // 30 minutes — paginated ticker fetching, 1s between pages
  CATEGORY_SYNC_TTL_MS: 2 * 60 * 1000, // 2 minutes — single API call with retry
  EXCHANGE_SYNC_TTL_MS: 10 * 60 * 1000, // 10 minutes — observed ~5.3 min, ~90% buffer
  LISTING_CROSS_LISTING_SEED_TTL_MS: 15 * 60 * 1000, // 15 minutes — per-exchange paginated fetch (cache hit: seconds; miss: ≤3 exchanges × pagination budget)
  DEFAULT_RETRY_DELAY_MS: 100,
  DEFAULT_MAX_RETRIES: 0
} as const;

export const LOCK_REDIS_DB = 4; // Dedicated DB for locks (separate from cache DB 2 and BullMQ DB 3)
