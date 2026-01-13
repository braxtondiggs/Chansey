export const LOCK_KEYS = {
  LIVE_TRADING: 'live-trading:execution-lock',
  OHLC_SYNC_SCHEDULE: 'ohlc-sync:schedule-lock'
} as const;

export const LOCK_DEFAULTS = {
  LIVE_TRADING_TTL_MS: 5 * 60 * 1000, // 5 minutes
  SCHEDULE_LOCK_TTL_MS: 30 * 1000, // 30 seconds for scheduling operations
  DEFAULT_RETRY_DELAY_MS: 100,
  DEFAULT_MAX_RETRIES: 0
} as const;

export const LOCK_REDIS_DB = 4; // Dedicated DB for locks (separate from cache DB 2 and BullMQ DB 3)
