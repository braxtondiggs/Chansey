export const LOCK_KEYS = {
  LIVE_TRADING: 'live-trading:execution-lock'
} as const;

export const LOCK_DEFAULTS = {
  LIVE_TRADING_TTL_MS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_RETRY_DELAY_MS: 100,
  DEFAULT_MAX_RETRIES: 0
} as const;

export const LOCK_REDIS_DB = 4; // Dedicated DB for locks (separate from cache DB 2 and BullMQ DB 3)
