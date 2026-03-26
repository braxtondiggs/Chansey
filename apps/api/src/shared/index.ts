export { cleanExchangeMessage, mapCcxtError } from './ccxt-error-mapper.util';
export { LOCK_DEFAULTS, LOCK_KEYS, LOCK_REDIS_DB } from './distributed-lock.constants';
export { DistributedLockService, LockInfo, LockOptions, LockResult } from './distributed-lock.service';
export { isUniqueConstraintViolation, toErrorInfo } from './error.util';
export {
  CCXT_DECIMAL_PLACES,
  CCXT_SIGNIFICANT_DIGITS,
  CCXT_TICK_SIZE,
  extractMarketLimits,
  MarketLimitsResult,
  precisionToStepSize
} from './precision.util';
export { LOCK_REDIS, lockRedisProvider } from './lock-redis.provider';
export { forceRemoveJob } from './queue.util';
export { SharedLockModule } from './shared-lock.module';
export { CooldownCheckResult, CooldownClaim, TradeCooldownService } from './trade-cooldown.service';

// Resilience patterns
export {
  CircuitBreakerOptions,
  CircuitBreakerService,
  CircuitOpenError,
  CircuitState,
  CircuitStats,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS
} from './circuit-breaker.service';
export {
  DEFAULT_RETRY_OPTIONS,
  extractRetryAfterMs,
  isAuthenticationError,
  isRateLimitError,
  isTransientError,
  RATE_LIMIT_RETRY_OPTIONS,
  RetryOptions,
  RetryResult,
  withRateLimitRetry,
  withRateLimitRetryThrow,
  withRetry,
  withRetryThrow
} from './retry.util';
export { SharedResilienceModule } from './shared-resilience.module';
